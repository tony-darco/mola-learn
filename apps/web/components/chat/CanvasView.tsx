"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { zoomIdentity } from "d3-zoom";
import type { z } from "zod";
import type { canvasPayloadSchema, CanvasElement } from "@mola/shared";
import { usePanZoom } from "@/lib/canvas/usePanZoom";
import { nextIndexAfterAll } from "@/lib/canvas/order";
import { recomputeParentIds, deleteElement } from "@/lib/canvas/membership";
import { finalizeStroke, type DraftPoint } from "@/lib/canvas/stroke";
import { strokeToSvgPath } from "@/lib/canvas/strokePath";
import { createSaveSerializer } from "@/lib/canvas/saveQueue";
import { saveCanvasAction } from "@/lib/canvas/actions";

type Payload = z.infer<typeof canvasPayloadSchema>;
type Tool = "select" | "draw" | "text" | "frame";

const COLORS = ["#1c1b18", "#481715", "#1e4d8f", "#2c5f4f"];
const DEFAULT_STROKE_WIDTH = 3;
const TEXT_DEFAULT_WIDTH = 180;
const TEXT_DEFAULT_HEIGHT = 32;
const FRAME_MIN_SIZE = 20;
const SAVE_DEBOUNCE_MS = 900;

export function CanvasView({
  canvasId, title, payload, initialVersion,
}: { canvasId: string; title: string; payload: Payload; initialVersion: number }) {
  const [elements, setElements] = useState<CanvasElement[]>(payload.elements);
  const [tool, setTool] = useState<Tool>("select");
  const [color, setColor] = useState(COLORS[0]!);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ points: DraftPoint[] } | null>(null);
  const [frameDraft, setFrameDraft] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);

  const elementsRef = useRef(elements);
  elementsRef.current = elements;
  const viewportRef = useRef(payload.viewport);
  const versionRef = useRef(initialVersion);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toolRef = useRef(tool);
  toolRef.current = tool;
  const editingTextIdRef = useRef(editingTextId);
  editingTextIdRef.current = editingTextId;
  const spaceHeldRef = useRef(false);

  const draftPointsRef = useRef<DraftPoint[]>([]);
  const draftRafRef = useRef<number | null>(null);
  const frameStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ id: string; startWorld: { x: number; y: number }; startX: number; startY: number } | null>(null);

  const serializer = useMemo(
    () =>
      createSaveSerializer(async (args: { elements: CanvasElement[]; viewport: typeof payload.viewport; expectedVersion: number }) => {
        setSaving(true);
        const result = await saveCanvasAction(canvasId, args.elements, args.viewport, args.expectedVersion);
        setSaving(false);
        if (result.ok) {
          versionRef.current = result.version;
          setConflict(false);
        } else {
          setConflict(true);
        }
        return result;
      }),
    [canvasId],
  );

  function requestSaveNow() {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    if (conflict) return; // stop autosaving until reload, per plan
    serializer.requestSave(() => ({ elements: elementsRef.current, viewport: viewportRef.current, expectedVersion: versionRef.current }));
  }

  /** Only content mutations schedule a save — panning/zooming never does. */
  function scheduleSave() {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(requestSaveNow, SAVE_DEBOUNCE_MS);
  }

  function mutate(updater: (prev: CanvasElement[]) => CanvasElement[]) {
    setElements((prev) => {
      const next = updater(prev);
      elementsRef.current = next;
      return next;
    });
    scheduleSave();
  }

  // Flush on unmount and on the tab being hidden/navigated away from — the
  // debounce window would otherwise silently drop edits made just before
  // either of those.
  useEffect(() => {
    function onVisibilityChange() { if (document.hidden) requestSaveNow(); }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      requestSaveNow();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs only; intentionally runs once.
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === "Space" && document.activeElement?.tagName !== "TEXTAREA") { spaceHeldRef.current = true; }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId && document.activeElement?.tagName !== "TEXTAREA" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        mutate((prev) => deleteElement(prev, selectedId));
        setSelectedId(null);
      }
    }
    function onKeyUp(e: KeyboardEvent) { if (e.code === "Space") spaceHeldRef.current = false; }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  function panFilter(event: Event): boolean {
    if (event.type === "wheel") return true;
    const me = event as MouseEvent;
    if (me.button === 1) return true;
    if (spaceHeldRef.current) return true;
    if (toolRef.current !== "select") return false;
    const target = me.target as Element;
    return !target.closest?.("[data-element-id]");
  }

  const { svgRef, transform, zoomBy, toWorld } = usePanZoom({
    filter: panFilter,
    initialTransform: zoomIdentity.translate(payload.viewport.x, payload.viewport.y).scale(payload.viewport.zoom),
  });

  useEffect(() => {
    viewportRef.current = { x: transform.x, y: transform.y, zoom: transform.k };
  }, [transform]);

  function worldFromEvent(e: React.PointerEvent | PointerEvent): { x: number; y: number } {
    return toWorld({ x: e.clientX, y: e.clientY });
  }

  function elementIdFromTarget(target: EventTarget | null): string | null {
    return (target as Element | null)?.closest?.("[data-element-id]")?.getAttribute("data-element-id") ?? null;
  }

  function handlePointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (spaceHeldRef.current || e.button === 1) return; // let d3-zoom pan

    if (tool === "select") {
      const id = elementIdFromTarget(e.target);
      if (!id) { setSelectedId(null); return; }
      if (id === editingTextIdRef.current) return; // let the textarea handle its own click
      setSelectedId(id);
      const el = elementsRef.current.find((x) => x.id === id);
      if (!el) return;
      (e.target as Element).setPointerCapture(e.pointerId);
      dragRef.current = { id, startWorld: worldFromEvent(e), startX: el.x, startY: el.y };
      return;
    }

    if (tool === "draw") {
      e.preventDefault();
      (e.target as Element).setPointerCapture(e.pointerId);
      const p = worldFromEvent(e);
      const point: DraftPoint = e.pointerType === "pen" ? { ...p, pressure: e.pressure } : p;
      draftPointsRef.current = [point];
      setDraft({ points: draftPointsRef.current });
      return;
    }

    if (tool === "frame") {
      e.preventDefault();
      (e.target as Element).setPointerCapture(e.pointerId);
      const start = worldFromEvent(e);
      frameStartRef.current = start;
      setFrameDraft({ x: start.x, y: start.y, width: 0, height: 0 });
      return;
    }
  }

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (dragRef.current) {
      const { id, startWorld, startX, startY } = dragRef.current;
      const p = worldFromEvent(e);
      const dx = p.x - startWorld.x, dy = p.y - startWorld.y;
      setElements((prev) => prev.map((el) => (el.id === id ? { ...el, x: startX + dx, y: startY + dy } : el)));
      return;
    }

    if (tool === "draw" && draftPointsRef.current.length > 0) {
      const p = worldFromEvent(e);
      const point: DraftPoint = e.pointerType === "pen" ? { ...p, pressure: e.pressure } : p;
      draftPointsRef.current = [...draftPointsRef.current, point];
      if (draftRafRef.current === null) {
        draftRafRef.current = requestAnimationFrame(() => {
          draftRafRef.current = null;
          setDraft({ points: draftPointsRef.current });
        });
      }
      return;
    }

    if (tool === "frame" && frameStartRef.current) {
      const start = frameStartRef.current;
      const p = worldFromEvent(e);
      setFrameDraft({
        x: Math.min(start.x, p.x), y: Math.min(start.y, p.y),
        width: Math.abs(p.x - start.x), height: Math.abs(p.y - start.y),
      });
      return;
    }
  }

  function handlePointerUp() {
    if (dragRef.current) {
      const id = dragRef.current.id;
      dragRef.current = null;
      mutate((prev) => recomputeParentIds(prev));
      void id;
      return;
    }

    if (tool === "draw" && draftPointsRef.current.length > 0) {
      const finalized = finalizeStroke(draftPointsRef.current);
      draftPointsRef.current = [];
      setDraft(null);
      if (finalized) {
        mutate((prev) => {
          const id = crypto.randomUUID();
          const withStroke: CanvasElement[] = [
            ...prev,
            {
              id, parentId: null, index: nextIndexAfterAll(prev),
              x: finalized.x, y: finalized.y, width: finalized.width, height: finalized.height,
              rotation: 0, createdBy: "user", type: "draw",
              props: { points: finalized.points, color, strokeWidth: DEFAULT_STROKE_WIDTH },
            },
          ];
          return recomputeParentIds(withStroke);
        });
      }
      return;
    }

    if (tool === "frame" && frameStartRef.current) {
      const fd = frameDraft;
      frameStartRef.current = null;
      setFrameDraft(null);
      if (fd && fd.width >= FRAME_MIN_SIZE && fd.height >= FRAME_MIN_SIZE) {
        mutate((prev) => {
          const id = crypto.randomUUID();
          const withFrame: CanvasElement[] = [
            ...prev,
            {
              id, parentId: null, index: nextIndexAfterAll(prev),
              x: fd.x, y: fd.y, width: fd.width, height: fd.height,
              rotation: 0, createdBy: "user", type: "frame",
              props: { name: "Untitled frame" },
            },
          ];
          return recomputeParentIds(withFrame);
        });
        setSelectedId(null);
      }
      return;
    }
  }

  function handleClick(e: React.MouseEvent<SVGSVGElement>) {
    if (tool !== "text") return;
    const id = elementIdFromTarget(e.target);
    if (id) return; // clicked an existing element — don't stamp a note on top of it
    const p = toWorld({ x: e.clientX, y: e.clientY });
    const id2 = crypto.randomUUID();
    mutate((prev) => {
      const withText: CanvasElement[] = [
        ...prev,
        {
          id: id2, parentId: null, index: nextIndexAfterAll(prev),
          x: p.x, y: p.y, width: TEXT_DEFAULT_WIDTH, height: TEXT_DEFAULT_HEIGHT,
          rotation: 0, createdBy: "user", type: "text",
          props: { text: "", color, fontSize: 14 },
        },
      ];
      return recomputeParentIds(withText);
    });
    setEditingTextId(id2);
    setSelectedId(id2);
    setTool("select");
  }

  function handleDoubleClick(e: React.MouseEvent<SVGSVGElement>) {
    const id = elementIdFromTarget(e.target);
    if (!id) return;
    const el = elementsRef.current.find((x) => x.id === id);
    if (el?.type === "text") setEditingTextId(id);
  }

  function commitText(id: string, text: string) {
    setEditingTextId(null);
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      mutate((prev) => deleteElement(prev, id));
      if (selectedId === id) setSelectedId(null);
      return;
    }
    mutate((prev) => prev.map((e) => (e.id === id && e.type === "text" ? { ...e, props: { ...e.props, text } } : e)));
  }

  function renameFrame(id: string, name: string) {
    mutate((prev) => prev.map((e) => (e.id === id && e.type === "frame" ? { ...e, props: { ...e.props, name } } : e)));
  }

  const sorted = useMemo(() => [...elements].sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0)), [elements]);

  return (
    <div className="relative flex h-[calc(100vh-140px)] flex-col overflow-hidden rounded-xl border border-border bg-bg">
      <div className="flex items-center gap-2 border-b border-border bg-surface px-3 py-2">
        {(["select", "draw", "text", "frame"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTool(t)}
            className={`rounded-md px-2.5 py-1 text-sm capitalize ${
              tool === t ? "bg-accent text-accent-fg" : "text-fg-muted hover:bg-bg"
            }`}
          >
            {t}
          </button>
        ))}
        <div className="mx-2 h-5 w-px bg-border" />
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Color ${c}`}
            onClick={() => setColor(c)}
            className="h-5 w-5 rounded-full border"
            style={{ backgroundColor: c, borderColor: color === c ? "var(--accent)" : "transparent", borderWidth: color === c ? 2 : 1 }}
          />
        ))}
        <div className="ml-auto flex items-center gap-2 text-xs text-fg-muted">
          {conflict && <span className="text-red-600 dark:text-red-400">Changed elsewhere — reload to see the newest version</span>}
          {!conflict && saving && <span>Saving…</span>}
          <button type="button" onClick={() => zoomBy(1.3)} className="rounded-md border border-border px-2 py-1 hover:bg-bg">+</button>
          <button type="button" onClick={() => zoomBy(1 / 1.3)} className="rounded-md border border-border px-2 py-1 hover:bg-bg">−</button>
        </div>
      </div>

      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        className="flex-1 cursor-crosshair touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
          {sorted.map((el) => (
            <ElementShape
              key={el.id}
              element={el}
              selected={el.id === selectedId}
              editing={el.id === editingTextId}
              onCommitText={commitText}
              onRenameFrame={renameFrame}
            />
          ))}
          {draft && draft.points.length > 1 && (
            <path d={strokeToSvgPath({ points: draft.points, color, strokeWidth: DEFAULT_STROKE_WIDTH })} fill={color} />
          )}
          {frameDraft && (
            <rect
              x={frameDraft.x} y={frameDraft.y} width={frameDraft.width} height={frameDraft.height}
              fill="none" className="stroke-accent" strokeWidth={1.5} strokeDasharray="4 3"
            />
          )}
        </g>
      </svg>
    </div>
  );
}

function ElementShape({
  element, selected, editing, onCommitText, onRenameFrame,
}: {
  element: CanvasElement; selected: boolean; editing: boolean;
  onCommitText: (id: string, text: string) => void;
  onRenameFrame: (id: string, name: string) => void;
}) {
  if (element.type === "draw") {
    return <DrawShape element={element} />;
  }

  if (element.type === "frame") {
    return (
      <g data-element-id={element.id}>
        <rect
          x={element.x} y={element.y} width={element.width} height={element.height}
          fill="none" stroke={selected ? "var(--accent)" : "var(--border)"} strokeWidth={selected ? 2 : 1.5} strokeDasharray="4 3"
        />
        {selected ? (
          <foreignObject x={element.x} y={element.y - 22} width={Math.max(element.width, 100)} height={20}>
            <input
              defaultValue={element.props.name}
              onBlur={(e) => onRenameFrame(element.id, e.target.value || "Untitled frame")}
              className="w-full border-none bg-transparent text-xs text-fg-muted outline-none"
            />
          </foreignObject>
        ) : (
          <text x={element.x} y={element.y - 6} className="fill-fg-muted text-[11px]">{element.props.name}</text>
        )}
      </g>
    );
  }

  // text
  return (
    <foreignObject data-element-id={element.id} x={element.x} y={element.y} width={element.width} height={element.height}>
      <TextNote element={element} editing={editing} selected={selected} onCommit={onCommitText} />
    </foreignObject>
  );
}

/**
 * The outline path is a pure function of `points`, but perfect-freehand's
 * spacing/taper math leans on sqrt/atan2 — IEEE754 guarantees determinism
 * for +,-,*,/ but not for transcendental functions, whose last-bit result
 * can legitimately differ between Node's V8 (SSR) and the browser's V8
 * (hydration), producing a real but harmless server/client `d` mismatch.
 * Rather than fight that, the path is left empty through the render that
 * has to match SSR (mount === false) and computed only afterward, as an
 * ordinary post-hydration state update — never during hydration itself.
 */
function DrawShape({ element }: { element: Extract<CanvasElement, { type: "draw" }> }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const d = useMemo(() => (mounted ? strokeToSvgPath(element.props) : ""), [element.props, mounted]);

  return (
    <path
      data-element-id={element.id}
      d={d}
      transform={`translate(${element.x},${element.y})`}
      fill={element.props.color}
    />
  );
}

function TextNote({
  element, editing, selected, onCommit,
}: {
  element: Extract<CanvasElement, { type: "text" }>; editing: boolean; selected: boolean;
  onCommit: (id: string, text: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (editing && ref.current) { ref.current.focus(); autoGrow(ref.current); }
  }, [editing]);

  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  if (!editing) {
    return (
      <div
        className={`h-full w-full whitespace-pre-wrap rounded px-1.5 py-1 text-sm ${selected ? "ring-2 ring-accent" : ""}`}
        style={{ color: element.props.color, fontSize: element.props.fontSize }}
      >
        {element.props.text || <span className="italic text-fg-muted">empty note</span>}
      </div>
    );
  }

  return (
    <textarea
      ref={ref}
      defaultValue={element.props.text}
      style={{ color: element.props.color, fontSize: element.props.fontSize }}
      className="w-full resize-none overflow-hidden rounded border border-accent bg-surface px-1.5 py-1 text-sm outline-none"
      onInput={(e) => autoGrow(e.currentTarget)}
      onBlur={(e) => onCommit(element.id, e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape") e.currentTarget.blur();
      }}
    />
  );
}
