"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { zoomIdentity } from "d3-zoom";
import type { z } from "zod";
import type { canvasDashStyleSchema, canvasFillStyleSchema, canvasPayloadSchema, CanvasElement } from "@mola/shared";
import { strokeToSvgPath } from "@/lib/canvas/strokePath";
import { usePanZoom } from "@/lib/canvas/usePanZoom";
import { nextIndexAfterAll } from "@/lib/canvas/order";
import { recomputeParentIds, deleteElement } from "@/lib/canvas/membership";
import { finalizeStroke, type DraftPoint } from "@/lib/canvas/stroke";
import { createSaveSerializer } from "@/lib/canvas/saveQueue";
import { saveCanvasAction } from "@/lib/canvas/actions";
import { uploadCanvasImageAction } from "@/lib/canvas/imageUpload";
import { emptyHistory, pushHistory, redo as historyRedo, undo as historyUndo, type History } from "@/lib/canvas/history";
import { eraseWholeObjects, erasePartial } from "@/lib/canvas/eraser";
import { COLOR_PALETTE, ERASER_SIZES, NOTE_DEFAULT_COLOR, STROKE_WIDTHS, type WidthCategory } from "@/lib/canvas/styleConstants";
import { Toolbar, type EraserMode, type ShapeKind, type Tool } from "./canvas/Toolbar";
import { StylePanel, type StyleContext } from "./canvas/StylePanel";
import { ElementShape } from "./canvas/ElementRenderer";
import { useConfirm } from "./shell-context";

type Payload = z.infer<typeof canvasPayloadSchema>;
type DashStyle = z.infer<typeof canvasDashStyleSchema>;
type FillStyle = z.infer<typeof canvasFillStyleSchema>;

const TEXT_DEFAULT_WIDTH = 180;
const TEXT_DEFAULT_HEIGHT = 32;
const NOTE_DEFAULT_SIZE = 140;
const MATH_DEFAULT_WIDTH = 160;
const MATH_DEFAULT_HEIGHT = 40;
const FRAME_MIN_SIZE = 20;
const SAVE_DEBOUNCE_MS = 900;
const LASER_FADE_MS = 700;
const BG_PATTERN_ID = "canvas-bg-pattern";

export function CanvasView({
  canvasId, title, payload, initialVersion,
}: { canvasId: string; title: string; payload: Payload; initialVersion: number }) {
  const confirm = useConfirm();

  const [elements, setElements] = useState<CanvasElement[]>(payload.elements);
  const [tool, setTool] = useState<Tool>("select");
  const [locked, setLocked] = useState(false);
  const [shapeKind, setShapeKind] = useState<ShapeKind>("rectangle");
  const [eraserMode, setEraserMode] = useState<EraserMode>("standard");
  const [eraserSize, setEraserSize] = useState<WidthCategory>("M");
  const [color, setColor] = useState(COLOR_PALETTE[0]!);
  const [widthCategory, setWidthCategory] = useState<WidthCategory>("M");
  const [dash, setDash] = useState<DashStyle>("solid");
  const [fillStyle, setFillStyle] = useState<FillStyle>("none");
  const [opacity, setOpacity] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ points: DraftPoint[] } | null>(null);
  const [lineDraft, setLineDraft] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [boxDraft, setBoxDraft] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [laserPoints, setLaserPoints] = useState<{ x: number; y: number; t: number }[]>([]);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);

  const elementsRef = useRef(elements);
  elementsRef.current = elements;
  const viewportRef = useRef(payload.viewport);
  const backgroundRef = useRef(payload.background);
  const versionRef = useRef(initialVersion);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyRef = useRef<History<CanvasElement[]>>(emptyHistory());

  const toolRef = useRef(tool); toolRef.current = tool;
  const editingIdRef = useRef(editingId); editingIdRef.current = editingId;
  const lockedRef = useRef(locked); lockedRef.current = locked;
  const spaceHeldRef = useRef(false);

  const draftPointsRef = useRef<DraftPoint[]>([]);
  const draftRafRef = useRef<number | null>(null);
  const dragRef = useRef<{ id: string; startWorld: { x: number; y: number }; startX: number; startY: number } | null>(null);
  const boxStartRef = useRef<{ x: number; y: number } | null>(null);
  const lineStartRef = useRef<{ x: number; y: number } | null>(null);
  const eraserDraggingRef = useRef(false);
  const laserDraggingRef = useRef(false);
  const laserPruneRafRef = useRef<number | null>(null);

  const serializer = useMemo(
    () =>
      createSaveSerializer(
        async (args: { elements: CanvasElement[]; viewport: typeof payload.viewport; background: typeof payload.background; expectedVersion: number }) => {
          setSaving(true);
          const result = await saveCanvasAction(canvasId, args.elements, args.viewport, args.background, args.expectedVersion);
          setSaving(false);
          if (result.ok) { versionRef.current = result.version; setConflict(false); }
          else setConflict(true);
          return result;
        },
      ),
    [canvasId],
  );

  function requestSaveNow() {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    if (conflict) return;
    serializer.requestSave(() => ({
      elements: elementsRef.current,
      viewport: viewportRef.current,
      background: backgroundRef.current,
      expectedVersion: versionRef.current,
    }));
  }

  function scheduleSave() {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(requestSaveNow, SAVE_DEBOUNCE_MS);
  }

  /** Applies a state change without touching history — used for the many
   * incremental steps within one gesture (a select-drag's pointermoves, an
   * eraser drag's repeated erases). */
  function applyMutation(updater: (prev: CanvasElement[]) => CanvasElement[]) {
    setElements((prev) => {
      const next = updater(prev);
      elementsRef.current = next;
      return next;
    });
    scheduleSave();
  }

  /** Snapshots the current state onto the undo stack — call once, at the
   * start of a gesture (or immediately before a single-shot mutation). */
  function snapshotHistory() {
    historyRef.current = pushHistory(historyRef.current, elementsRef.current);
    setHistoryVersion((v) => v + 1);
  }

  /** Single-shot mutation: snapshot then apply, for anything that's exactly one committed change. */
  function mutate(updater: (prev: CanvasElement[]) => CanvasElement[]) {
    snapshotHistory();
    applyMutation(updater);
  }

  function handleUndo() {
    const result = historyUndo(historyRef.current, elementsRef.current);
    if (!result) return;
    historyRef.current = result.history;
    setHistoryVersion((v) => v + 1);
    applyMutation(() => result.value);
    setSelectedId(null);
  }
  function handleRedo() {
    const result = historyRedo(historyRef.current, elementsRef.current);
    if (!result) return;
    historyRef.current = result.history;
    setHistoryVersion((v) => v + 1);
    applyMutation(() => result.value);
    setSelectedId(null);
  }

  useEffect(() => {
    function onVisibilityChange() { if (document.hidden) requestSaveNow(); }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      requestSaveNow();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const inInput = document.activeElement?.tagName === "TEXTAREA" || document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "MATH-FIELD";
      if (e.code === "Space" && !inInput) spaceHeldRef.current = true;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !inInput) {
        e.preventDefault();
        if (e.shiftKey) handleRedo(); else handleUndo();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId && !inInput) {
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

  // Laser trail fade — keeps re-rendering while any point is still visible, pruning old ones.
  useEffect(() => {
    if (laserPoints.length === 0) return;
    function tick() {
      const now = Date.now();
      setLaserPoints((prev) => prev.filter((p) => now - p.t < LASER_FADE_MS));
      laserPruneRafRef.current = requestAnimationFrame(tick);
    }
    laserPruneRafRef.current = requestAnimationFrame(tick);
    return () => { if (laserPruneRafRef.current) cancelAnimationFrame(laserPruneRafRef.current); };
  }, [laserPoints.length > 0]);

  function panFilter(event: Event): boolean {
    if (event.type === "wheel") return true;
    const me = event as MouseEvent;
    if (me.button === 1) return true;
    if (spaceHeldRef.current) return true;
    if (toolRef.current === "pan") return true;
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

  function applyEraseAt(point: { x: number; y: number }) {
    const radius = ERASER_SIZES[eraserSize];
    applyMutation((prev) =>
      eraserMode === "stroke"
        ? eraseWholeObjects(prev, point.x, point.y, radius)
        : erasePartial(prev, point.x, point.y, radius, () => crypto.randomUUID()),
    );
  }

  function handlePointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (spaceHeldRef.current || e.button === 1 || tool === "pan") return;

    if (tool === "select") {
      const id = elementIdFromTarget(e.target);
      if (!id) { setSelectedId(null); return; }
      if (id === editingIdRef.current) return;
      setSelectedId(id);
      const el = elementsRef.current.find((x) => x.id === id);
      if (!el) return;
      (e.target as Element).setPointerCapture(e.pointerId);
      snapshotHistory();
      dragRef.current = { id, startWorld: worldFromEvent(e), startX: el.x, startY: el.y };
      return;
    }

    if (tool === "draw" || tool === "highlighter") {
      e.preventDefault();
      (e.target as Element).setPointerCapture(e.pointerId);
      const p = worldFromEvent(e);
      const point: DraftPoint = e.pointerType === "pen" ? { ...p, pressure: e.pressure } : p;
      draftPointsRef.current = [point];
      setDraft({ points: draftPointsRef.current });
      return;
    }

    if (tool === "line" || tool === "arrow") {
      e.preventDefault();
      (e.target as Element).setPointerCapture(e.pointerId);
      const start = worldFromEvent(e);
      lineStartRef.current = start;
      setLineDraft({ x1: start.x, y1: start.y, x2: start.x, y2: start.y });
      return;
    }

    if (tool === "shape" || tool === "frame") {
      e.preventDefault();
      (e.target as Element).setPointerCapture(e.pointerId);
      const start = worldFromEvent(e);
      boxStartRef.current = start;
      setBoxDraft({ x: start.x, y: start.y, width: 0, height: 0 });
      return;
    }

    if (tool === "eraser") {
      e.preventDefault();
      (e.target as Element).setPointerCapture(e.pointerId);
      eraserDraggingRef.current = true;
      snapshotHistory();
      applyEraseAt(worldFromEvent(e));
      return;
    }

    if (tool === "laser") {
      e.preventDefault();
      (e.target as Element).setPointerCapture(e.pointerId);
      laserDraggingRef.current = true;
      setLaserPoints((prev) => [...prev, { ...worldFromEvent(e), t: Date.now() }]);
      return;
    }
  }

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (dragRef.current) {
      const { id, startWorld, startX, startY } = dragRef.current;
      const p = worldFromEvent(e);
      const dx = p.x - startWorld.x, dy = p.y - startWorld.y;
      applyMutation((prev) => prev.map((el) => (el.id === id ? { ...el, x: startX + dx, y: startY + dy } : el)));
      return;
    }

    if ((tool === "draw" || tool === "highlighter") && draftPointsRef.current.length > 0) {
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

    if ((tool === "line" || tool === "arrow") && lineStartRef.current) {
      const p = worldFromEvent(e);
      setLineDraft({ x1: lineStartRef.current.x, y1: lineStartRef.current.y, x2: p.x, y2: p.y });
      return;
    }

    if ((tool === "shape" || tool === "frame") && boxStartRef.current) {
      const start = boxStartRef.current;
      const p = worldFromEvent(e);
      setBoxDraft({ x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), width: Math.abs(p.x - start.x), height: Math.abs(p.y - start.y) });
      return;
    }

    if (tool === "eraser" && eraserDraggingRef.current) {
      applyEraseAt(worldFromEvent(e));
      return;
    }

    if (tool === "laser" && laserDraggingRef.current) {
      setLaserPoints((prev) => [...prev, { ...worldFromEvent(e), t: Date.now() }]);
      return;
    }
  }

  function handlePointerUp() {
    if (dragRef.current) {
      dragRef.current = null;
      applyMutation((prev) => recomputeParentIds(prev));
      return;
    }

    if ((tool === "draw" || tool === "highlighter") && draftPointsRef.current.length > 0) {
      const finalized = finalizeStroke(draftPointsRef.current);
      draftPointsRef.current = [];
      setDraft(null);
      if (finalized) {
        mutate((prev) => {
          const el: CanvasElement = {
            id: crypto.randomUUID(), parentId: null, index: nextIndexAfterAll(prev),
            x: finalized.x, y: finalized.y, width: finalized.width, height: finalized.height,
            rotation: 0, opacity, createdBy: "user", type: "draw",
            props: { points: finalized.points, color, strokeWidth: STROKE_WIDTHS[widthCategory], variant: tool === "highlighter" ? "highlighter" : "pen" },
          };
          return recomputeParentIds([...prev, el]);
        });
      }
      return;
    }

    if ((tool === "line" || tool === "arrow") && lineStartRef.current) {
      const ld = lineDraft;
      lineStartRef.current = null;
      setLineDraft(null);
      if (ld && (Math.abs(ld.x2 - ld.x1) > 2 || Math.abs(ld.y2 - ld.y1) > 2)) {
        mutate((prev) => {
          const el: CanvasElement = {
            id: crypto.randomUUID(), parentId: null, index: nextIndexAfterAll(prev),
            x: ld.x1, y: ld.y1, width: Math.abs(ld.x2 - ld.x1), height: Math.abs(ld.y2 - ld.y1),
            rotation: 0, opacity, createdBy: "user", type: "line",
            props: {
              endX: ld.x2 - ld.x1, endY: ld.y2 - ld.y1, color, strokeWidth: STROKE_WIDTHS[widthCategory],
              dash, startArrow: false, endArrow: tool === "arrow",
            },
          };
          return recomputeParentIds([...prev, el]);
        });
      }
      return;
    }

    if (tool === "shape" && boxStartRef.current) {
      const bd = boxDraft;
      boxStartRef.current = null;
      setBoxDraft(null);
      if (bd && bd.width >= 4 && bd.height >= 4) {
        mutate((prev) => {
          const el: CanvasElement = {
            id: crypto.randomUUID(), parentId: null, index: nextIndexAfterAll(prev),
            x: bd.x, y: bd.y, width: bd.width, height: bd.height,
            rotation: 0, opacity, createdBy: "user", type: "shape",
            props: {
              shapeKind, color, fillColor: fillStyle === "none" ? null : color, fillStyle,
              strokeWidth: STROKE_WIDTHS[widthCategory], dash,
            },
          };
          return recomputeParentIds([...prev, el]);
        });
      }
      return;
    }

    if (tool === "frame" && boxStartRef.current) {
      const bd = boxDraft;
      boxStartRef.current = null;
      setBoxDraft(null);
      if (bd && bd.width >= FRAME_MIN_SIZE && bd.height >= FRAME_MIN_SIZE) {
        mutate((prev) => {
          const el: CanvasElement = {
            id: crypto.randomUUID(), parentId: null, index: nextIndexAfterAll(prev),
            x: bd.x, y: bd.y, width: bd.width, height: bd.height,
            rotation: 0, opacity: 1, createdBy: "user", type: "frame",
            props: { name: "Untitled frame" },
          };
          return recomputeParentIds([...prev, el]);
        });
      }
      return;
    }

    if (tool === "eraser") { eraserDraggingRef.current = false; return; }
    if (tool === "laser") { laserDraggingRef.current = false; return; }
  }

  function handleClick(e: React.MouseEvent<SVGSVGElement>) {
    if (tool !== "text" && tool !== "note" && tool !== "math") return;
    const id = elementIdFromTarget(e.target);
    if (id) return;
    const p = toWorld({ x: e.clientX, y: e.clientY });
    const newId = crypto.randomUUID();

    mutate((prev) => {
      let el: CanvasElement;
      if (tool === "text") {
        el = {
          id: newId, parentId: null, index: nextIndexAfterAll(prev),
          x: p.x, y: p.y, width: TEXT_DEFAULT_WIDTH, height: TEXT_DEFAULT_HEIGHT,
          rotation: 0, opacity: 1, createdBy: "user", type: "text",
          props: { text: "", color, fontSize: 14 },
        };
      } else if (tool === "note") {
        el = {
          id: newId, parentId: null, index: nextIndexAfterAll(prev),
          x: p.x, y: p.y, width: NOTE_DEFAULT_SIZE, height: NOTE_DEFAULT_SIZE,
          rotation: 0, opacity: 1, createdBy: "user", type: "note",
          props: { text: "", color: NOTE_DEFAULT_COLOR, textColor: color, fontSize: 14 },
        };
      } else {
        el = {
          id: newId, parentId: null, index: nextIndexAfterAll(prev),
          x: p.x, y: p.y, width: MATH_DEFAULT_WIDTH, height: MATH_DEFAULT_HEIGHT,
          rotation: 0, opacity: 1, createdBy: "user", type: "math",
          props: { latex: "", color, fontSize: 20 },
        };
      }
      return recomputeParentIds([...prev, el]);
    });
    setEditingId(newId);
    setSelectedId(newId);
    if (!lockedRef.current) setTool("select");
  }

  function handleDoubleClick(e: React.MouseEvent<SVGSVGElement>) {
    const id = elementIdFromTarget(e.target);
    if (!id) return;
    const el = elementsRef.current.find((x) => x.id === id);
    if (el?.type === "text" || el?.type === "note" || el?.type === "math") setEditingId(id);
  }

  function commitText(id: string, text: string) {
    setEditingId(null);
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      mutate((prev) => deleteElement(prev, id));
      if (selectedId === id) setSelectedId(null);
      return;
    }
    mutate((prev) =>
      prev.map((e) => {
        if (e.id !== id) return e;
        if (e.type === "text") return { ...e, props: { ...e.props, text } };
        if (e.type === "note") return { ...e, props: { ...e.props, text } };
        return e;
      }),
    );
  }

  function commitMath(id: string, latex: string) {
    setEditingId(null);
    const trimmed = latex.trim();
    if (trimmed.length === 0) {
      mutate((prev) => deleteElement(prev, id));
      if (selectedId === id) setSelectedId(null);
      return;
    }
    mutate((prev) => prev.map((e) => (e.id === id && e.type === "math" ? { ...e, props: { ...e.props, latex } } : e)));
  }

  function renameFrame(id: string, name: string) {
    mutate((prev) => prev.map((e) => (e.id === id && e.type === "frame" ? { ...e, props: { ...e.props, name } } : e)));
  }

  async function handleUploadImage(file: File) {
    const formData = new FormData();
    formData.append("file", file);
    const { url } = await uploadCanvasImageAction(formData);

    const img = new Image();
    img.onload = () => {
      const rect = svgRef.current?.getBoundingClientRect();
      const center = rect ? toWorld({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }) : { x: 0, y: 0 };
      const maxDim = 320;
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
      const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
      mutate((prev) => {
        const el: CanvasElement = {
          id: crypto.randomUUID(), parentId: null, index: nextIndexAfterAll(prev),
          x: center.x - w / 2, y: center.y - h / 2, width: w, height: h,
          rotation: 0, opacity: 1, createdBy: "user", type: "image",
          props: { url, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight },
        };
        return recomputeParentIds([...prev, el]);
      });
    };
    img.src = url;
  }

  async function handleClearCanvas() {
    if (elementsRef.current.length === 0) return;
    const ok = await confirm("Clear the whole canvas? This removes every element — you can undo it with Ctrl/Cmd+Z right after.");
    if (!ok) return;
    mutate(() => []);
    setSelectedId(null);
  }

  const canUndo = useMemo(() => historyRef.current.past.length > 0, [historyVersion]);
  const canRedo = useMemo(() => historyRef.current.future.length > 0, [historyVersion]);
  const sorted = useMemo(() => [...elements].sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0)), [elements]);
  const styleContext: StyleContext = { dash: tool === "line" || tool === "arrow" || tool === "shape", fill: tool === "shape" };
  const showStylePanel = ["draw", "highlighter", "line", "arrow", "shape", "text", "note", "math"].includes(tool);
  const now = Date.now();
  const visibleLaser = laserPoints.filter((p) => now - p.t < LASER_FADE_MS);

  return (
    <div className="relative flex h-[calc(100vh-140px)] flex-col overflow-hidden rounded-xl border border-border bg-bg">
      <Toolbar
        tool={tool} onToolChange={setTool}
        locked={locked} onLockedChange={setLocked}
        shapeKind={shapeKind} onShapeKindChange={setShapeKind}
        eraserMode={eraserMode} onEraserModeChange={setEraserMode}
        eraserSize={eraserSize} onEraserSizeChange={setEraserSize}
        canUndo={canUndo} canRedo={canRedo}
        onUndo={handleUndo} onRedo={handleRedo}
        onUploadImage={handleUploadImage} onClearCanvas={handleClearCanvas} onZoomBy={zoomBy}
      />

      {showStylePanel && (
        <StylePanel
          context={styleContext}
          color={color} onColorChange={setColor}
          widthCategory={widthCategory} onWidthChange={setWidthCategory}
          opacity={opacity} onOpacityChange={setOpacity}
          dash={dash} onDashChange={setDash}
          fillStyle={fillStyle} onFillStyleChange={setFillStyle}
        />
      )}

      {conflict && (
        <div className="absolute right-3 top-16 z-10 rounded-md border border-red-300 bg-surface px-3 py-1.5 text-xs text-red-600 shadow dark:border-red-900 dark:text-red-400">
          This canvas changed elsewhere — reload to see the newest version.
        </div>
      )}
      {!conflict && saving && (
        <div className="absolute right-3 top-16 z-10 text-xs text-fg-muted">Saving…</div>
      )}

      <svg
        ref={svgRef}
        width="100%" height="100%"
        className="flex-1 cursor-crosshair touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
          <BackgroundLayer background={payload.background} />

          {sorted.map((el) => (
            <ElementShape
              key={el.id}
              element={el}
              selected={el.id === selectedId}
              editing={el.id === editingId}
              onCommitText={commitText}
              onCommitMath={commitMath}
              onRenameFrame={renameFrame}
            />
          ))}

          {draft && draft.points.length > 1 && <DraftStroke points={draft.points} color={color} highlighter={tool === "highlighter"} />}

          {lineDraft && (
            <line x1={lineDraft.x1} y1={lineDraft.y1} x2={lineDraft.x2} y2={lineDraft.y2} stroke={color} strokeWidth={STROKE_WIDTHS[widthCategory]} strokeDasharray="4 3" />
          )}

          {boxDraft && (tool === "shape" || tool === "frame") && (
            <rect x={boxDraft.x} y={boxDraft.y} width={boxDraft.width} height={boxDraft.height} fill="none" className="stroke-accent" strokeWidth={1.5} strokeDasharray="4 3" />
          )}

          {visibleLaser.length >= 2 && (
            <>
              <path
                d={visibleLaser.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ")}
                fill="none" stroke="#ef4444" strokeWidth={3} strokeLinecap="round" opacity={0.8}
              />
              <circle cx={visibleLaser[visibleLaser.length - 1]!.x} cy={visibleLaser[visibleLaser.length - 1]!.y} r={5} fill="#ef4444" />
            </>
          )}
        </g>
      </svg>
    </div>
  );
}

function DraftStroke({ points, color, highlighter }: { points: DraftPoint[]; color: string; highlighter: boolean }) {
  // Local, live preview only — never persisted, so no SSR/hydration concern; safe to compute directly every render.
  const d = strokeToSvgPath({ points, color, strokeWidth: STROKE_WIDTHS.M, variant: highlighter ? "highlighter" : "pen" });
  return <path d={d} fill={color} opacity={highlighter ? 0.4 : 1} />;
}

function BackgroundLayer({ background }: { background: Payload["background"] }) {
  if (background.pattern === "blank") {
    return <rect x={-5000} y={-5000} width={10000} height={10000} fill={background.color} />;
  }
  return (
    <>
      <rect x={-5000} y={-5000} width={10000} height={10000} fill={background.color} />
      <defs>
        <pattern id={BG_PATTERN_ID} width={24} height={24} patternUnits="userSpaceOnUse">
          {background.pattern === "dots" && <circle cx={2} cy={2} r={1.2} className="fill-border" />}
          {background.pattern === "grid" && <path d="M 24 0 L 0 0 0 24" fill="none" className="stroke-border" strokeWidth={1} />}
          {background.pattern === "lines" && <line x1={0} y1={24} x2={24} y2={24} className="stroke-border" strokeWidth={1} />}
        </pattern>
      </defs>
      <rect x={-5000} y={-5000} width={10000} height={10000} fill={`url(#${BG_PATTERN_ID})`} />
    </>
  );
}
