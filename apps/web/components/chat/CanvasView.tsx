"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { zoomIdentity } from "d3-zoom";
import { MessageSquare } from "lucide-react";
import type { z } from "zod";
import type { canvasDashStyleSchema, canvasFillStyleSchema, canvasPayloadSchema, CanvasElement } from "@mola/shared";
import { strokeToPolylinePath, strokeToSvgPath } from "@/lib/canvas/strokePath";
import { usePanZoom } from "@/lib/canvas/usePanZoom";
import { nextIndexAfterAll } from "@/lib/canvas/order";
import { recomputeParentIds, deleteElement } from "@/lib/canvas/membership";
import { finalizeStroke, type DraftPoint } from "@/lib/canvas/stroke";
import { createSaveSerializer } from "@/lib/canvas/saveQueue";
import { saveCanvasAction } from "@/lib/canvas/actions";
import { uploadCanvasImageAction } from "@/lib/canvas/imageUpload";
import { emptyHistory, pushHistory, redo as historyRedo, undo as historyUndo, type History } from "@/lib/canvas/history";
import { applyAIElement, type AIStep } from "@/lib/canvas/aiEdits";
import { eraseWholeObjects, erasePartial } from "@/lib/canvas/eraser";
import { resizeBox, type ResizeCorner } from "@/lib/canvas/resize";
import { cursorForTool } from "@/lib/canvas/cursors";
import { boundsOf, elementsInRect, rectFromPoints, toScreenRect, unionRect, type Rect } from "@/lib/canvas/marquee";
import { aiInk, COLOR_PALETTE, ERASER_SIZES, FONT_SIZES, NOTE_DEFAULT_COLOR, STROKE_WIDTHS, type WidthCategory } from "@/lib/canvas/styleConstants";
import { Toolbar, type EraserMode, type ShapeKind, type Tool } from "./canvas/Toolbar";
import { BottomPill } from "./canvas/BottomPill";
import { StylePanel, type StyleContext } from "./canvas/StylePanel";
import { ElementShape, SelectionOutline, ShapeOutline } from "./canvas/ElementRenderer";
import { SelectionMenu } from "./canvas/SelectionMenu";
import { CanvasChatPanel, type ChatAttachment } from "./canvas/CanvasChatPanel";
import { useCanvasChat } from "./canvas/useCanvasChat";
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
const MIN_AUTO_FIT_FONT_SIZE = 8;
const SAVE_DEBOUNCE_MS = 900;
const LASER_FADE_MS = 700;
const BG_PATTERN_ID = "canvas-bg-pattern";
const CHECK_MY_WORK = "Check my work in this selection.";

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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Single-selection UI (resize handles, the edit badge, the text style
  // panel) only makes sense for exactly one selected element.
  const selectedId = selectedIds.size === 1 ? [...selectedIds][0]! : null;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ points: DraftPoint[] } | null>(null);
  const [lineDraft, setLineDraft] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [boxDraft, setBoxDraft] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [laserPoints, setLaserPoints] = useState<{ x: number; y: number; t: number }[]>([]);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [background, setBackground] = useState(payload.background);
  /** The Shift-drag rectangle while it's being drawn, in world coordinates. */
  const [marquee, setMarquee] = useState<Rect | null>(null);
  /** The area the marquees drew around the current selection — kept with the exact Set it made, so any other
   * change to the selection (a new Set) drops it, and Ask AI falls back to the selected elements' bounds. */
  const [marqueeArea, setMarqueeArea] = useState<{ ids: Set<string>; rect: Rect } | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [attachment, setAttachment] = useState<ChatAttachment | null>(null);
  const chat = useCanvasChat(canvasId, applyFromAI);
  const syncEditsRef = useRef(chat.syncEdits);
  syncEditsRef.current = chat.syncEdits;

  const elementsRef = useRef(elements);
  elementsRef.current = elements;
  const viewportRef = useRef(payload.viewport);
  const backgroundRef = useRef(background);
  backgroundRef.current = background;
  const versionRef = useRef(initialVersion);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyRef = useRef<History<CanvasElement[]>>(emptyHistory());
  const aiStepRef = useRef<AIStep | null>(null);
  const resizeRef = useRef<{ id: string; corner: ResizeCorner } | null>(null);

  const toolRef = useRef(tool); toolRef.current = tool;
  const editingIdRef = useRef(editingId); editingIdRef.current = editingId;
  const lockedRef = useRef(locked); lockedRef.current = locked;
  const spaceHeldRef = useRef(false);

  const draftPointsRef = useRef<DraftPoint[]>([]);
  const draftRafRef = useRef<number | null>(null);
  const dragRef = useRef<{ ids: string[]; startWorld: { x: number; y: number }; startPositions: Map<string, { x: number; y: number }> } | null>(null);
  const boxStartRef = useRef<{ x: number; y: number } | null>(null);
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
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
          if (result.ok) {
            versionRef.current = result.version;
            setConflict(false);
            // The chat's edit log reads the board as saved — but not while more edits wait to be saved: the save after them will.
            if (!saveTimerRef.current) syncEditsRef.current();
          } else setConflict(true);
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

  /** The canvas chat reads the board from what's saved — so save now, and wait for it, before asking. */
  async function flushSave() {
    if (saveTimerRef.current) requestSaveNow();
    while (serializer.isInFlight) await new Promise((resolve) => setTimeout(resolve, 50));
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

  /** Background isn't part of element history — a pattern/color swap isn't
   * something you'd expect Ctrl+Z to undo one element at a time. */
  function updateBackgroundPattern(pattern: Payload["background"]["pattern"]) {
    setBackground((prev) => {
      const next = { ...prev, pattern };
      backgroundRef.current = next;
      return next;
    });
    scheduleSave();
  }

  function handleUndo() {
    const result = historyUndo(historyRef.current, elementsRef.current);
    if (!result) return;
    historyRef.current = result.history;
    setHistoryVersion((v) => v + 1);
    applyMutation(() => result.value);
    setSelectedIds(new Set());
  }
  function handleRedo() {
    const result = historyRedo(historyRef.current, elementsRef.current);
    if (!result) return;
    historyRef.current = result.history;
    setHistoryVersion((v) => v + 1);
    applyMutation(() => result.value);
    setSelectedIds(new Set());
  }

  function deleteSelected() {
    mutate((prev) => [...selectedIds].reduce((acc, id) => deleteElement(acc, id), prev));
    setSelectedIds(new Set());
  }

  /** An element the canvas chat's reply put on the board: on top, saved as usual, and the reply's changes one undo step (lib/canvas/aiEdits.ts). */
  function applyFromAI(messageId: string, element: CanvasElement) {
    const next = applyAIElement({ elements: elementsRef.current, history: historyRef.current, step: aiStepRef.current }, messageId, element);
    if (next.elements === elementsRef.current) return;
    historyRef.current = next.history;
    aiStepRef.current = next.step;
    // Now, not when React gets to the update: a reply's next element can arrive before it does.
    elementsRef.current = next.elements;
    setHistoryVersion((v) => v + 1);
    applyMutation(() => next.elements);
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
      if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.size > 0 && !inInput) {
        e.preventDefault();
        deleteSelected();
      }
    }
    function onKeyUp(e: KeyboardEvent) { if (e.code === "Space") spaceHeldRef.current = false; }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds]);

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
    // Shift + drag on empty space draws a marquee instead (handlePointerDown).
    if (me.shiftKey) return false;
    const target = me.target as Element;
    return !target.closest?.("[data-element-id]");
  }

  const { svgRef, transform, zoomBy, toWorld, setTransform } = usePanZoom({
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
      const target = e.target as Element;
      if (e.shiftKey && !elementIdFromTarget(target)) {
        e.preventDefault();
        target.setPointerCapture(e.pointerId);
        const start = worldFromEvent(e);
        marqueeStartRef.current = start;
        setMarquee(rectFromPoints(start, start));
        return;
      }
      // Moving, resizing or re-selecting leaves behind the area a marquee drew.
      setMarqueeArea(null);

      const handleEl = target.closest?.("[data-resize-handle]");
      if (handleEl) {
        const id = handleEl.getAttribute("data-element-id")!;
        const corner = handleEl.getAttribute("data-resize-handle") as ResizeCorner;
        target.setPointerCapture(e.pointerId);
        snapshotHistory();
        resizeRef.current = { id, corner };
        return;
      }

      const id = elementIdFromTarget(e.target);
      if (!id) { if (!e.shiftKey) setSelectedIds(new Set()); return; }
      if (id === editingIdRef.current) return;

      // Shift-click toggles membership; clicking a member of an existing
      // multi-selection keeps the whole group selected (so the drag below
      // moves all of them); a plain click on anything else re-selects just
      // that one element.
      let nextSelected: Set<string>;
      if (e.shiftKey) {
        nextSelected = new Set(selectedIds);
        if (nextSelected.has(id)) nextSelected.delete(id); else nextSelected.add(id);
      } else if (selectedIds.has(id) && selectedIds.size > 1) {
        nextSelected = selectedIds;
      } else {
        nextSelected = new Set([id]);
      }
      setSelectedIds(nextSelected);

      const dragIds = nextSelected.has(id) ? [...nextSelected] : [id];
      const startPositions = new Map(
        dragIds.map((dragId) => {
          const el = elementsRef.current.find((x) => x.id === dragId)!;
          return [dragId, { x: el.x, y: el.y }] as const;
        }),
      );
      target.setPointerCapture(e.pointerId);
      snapshotHistory();
      dragRef.current = { ids: dragIds, startWorld: worldFromEvent(e), startPositions };
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
    if (marqueeStartRef.current) {
      setMarquee(rectFromPoints(marqueeStartRef.current, worldFromEvent(e)));
      return;
    }

    if (resizeRef.current) {
      const { id, corner } = resizeRef.current;
      const p = worldFromEvent(e);
      applyMutation((prev) => prev.map((el) => (el.id === id ? { ...el, ...resizeBox(el, corner, p) } : el)));
      return;
    }

    if (dragRef.current) {
      const { startWorld, startPositions } = dragRef.current;
      const p = worldFromEvent(e);
      const dx = p.x - startWorld.x, dy = p.y - startWorld.y;
      applyMutation((prev) =>
        prev.map((el) => {
          const start = startPositions.get(el.id);
          return start ? { ...el, x: start.x + dx, y: start.y + dy } : el;
        }),
      );
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

  function handlePointerUp(e: React.PointerEvent<SVGSVGElement>) {
    if (marqueeStartRef.current) {
      finishMarquee(rectFromPoints(marqueeStartRef.current, worldFromEvent(e)));
      marqueeStartRef.current = null;
      setMarquee(null);
      return;
    }

    if (resizeRef.current) {
      resizeRef.current = null;
      applyMutation((prev) => recomputeParentIds(prev));
      return;
    }

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
            props: { points: finalized.points, color, strokeWidth: STROKE_WIDTHS[widthCategory], variant: tool === "highlighter" ? "highlighter" : "pen", dash },
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

  /** Adds what's mostly inside the rectangle to the selection, and keeps the area for Ask AI. */
  function finishMarquee(rect: Rect) {
    const hits = elementsInRect(elementsRef.current, rect).filter((id) => !selectedIds.has(id));
    if (hits.length === 0) return;
    // What was already selected stays covered: by the earlier marquees' area, or by its own bounds.
    const before = marqueeArea?.ids === selectedIds
      ? marqueeArea.rect
      : boundsOf(elementsRef.current.filter((el) => selectedIds.has(el.id)));
    const next = new Set([...selectedIds, ...hits]);
    setSelectedIds(next);
    setMarqueeArea({ ids: next, rect: before ? unionRect(before, rect) : rect });
  }

  function openChat() {
    setChatOpen(true);
    void chat.ensureLoaded();
  }

  async function sendToChat(message: string, rect: Rect | null) {
    await flushSave();
    await chat.send(message, rect);
  }

  /** Ask AI / Check my work: attach the selection to the chat, and for a check, ask straight away. */
  function askAboutSelection(checkWork: boolean) {
    if (!selectionArea) return;
    const next = { rect: selectionArea, count: selectedIds.size };
    setAttachment(next);
    openChat();
    if (checkWork) void sendToChat(CHECK_MY_WORK, next.rect);
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
          props: { text: "", color, fontSize: FONT_SIZES[widthCategory], backgroundColor: null, bold: false, italic: false, textAlign: "left", autoFit: "grow" },
        };
      } else if (tool === "note") {
        el = {
          id: newId, parentId: null, index: nextIndexAfterAll(prev),
          x: p.x, y: p.y, width: NOTE_DEFAULT_SIZE, height: NOTE_DEFAULT_SIZE,
          rotation: 0, opacity: 1, createdBy: "user", type: "note",
          props: { text: "", color: NOTE_DEFAULT_COLOR, textColor: color, fontSize: FONT_SIZES[widthCategory], bold: false, italic: false, textAlign: "left", autoFit: "grow" },
        };
      } else {
        el = {
          id: newId, parentId: null, index: nextIndexAfterAll(prev),
          x: p.x, y: p.y, width: MATH_DEFAULT_WIDTH, height: MATH_DEFAULT_HEIGHT,
          rotation: 0, opacity: 1, createdBy: "user", type: "math",
          props: { latex: "", color, fontSize: FONT_SIZES[widthCategory] },
        };
      }
      return recomputeParentIds([...prev, el]);
    });
    setEditingId(newId);
    setSelectedIds(new Set([newId]));
    if (!lockedRef.current) setTool("select");
  }

  function handleDoubleClick(e: React.MouseEvent<SVGSVGElement>) {
    const id = elementIdFromTarget(e.target);
    if (!id) return;
    const el = elementsRef.current.find((x) => x.id === id);
    if (el?.type === "text" || el?.type === "note" || el?.type === "math") setEditingId(id);
  }

  function commitText(id: string, text: string, contentHeight: number) {
    setEditingId(null);
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      mutate((prev) => deleteElement(prev, id));
      setSelectedIds((prev) => { if (!prev.has(id)) return prev; const next = new Set(prev); next.delete(id); return next; });
      return;
    }
    // contentHeight is measured in screen pixels; the box lives in world
    // coordinates, so it has to come back through the current zoom.
    const neededHeight = contentHeight / transform.k;
    mutate((prev) =>
      prev.map((e) => {
        if (e.id !== id) return e;
        if (e.type === "text") {
          const fit = applyAutoFit(e.props.autoFit, e.height, e.props.fontSize, neededHeight);
          return { ...e, height: fit.height, props: { ...e.props, text, fontSize: fit.fontSize } };
        }
        if (e.type === "note") {
          const fit = applyAutoFit(e.props.autoFit, e.height, e.props.fontSize, neededHeight);
          return { ...e, height: fit.height, props: { ...e.props, text, fontSize: fit.fontSize } };
        }
        return e;
      }),
    );
  }

  function commitMath(id: string, latex: string) {
    setEditingId(null);
    const trimmed = latex.trim();
    if (trimmed.length === 0) {
      mutate((prev) => deleteElement(prev, id));
      setSelectedIds((prev) => { if (!prev.has(id)) return prev; const next = new Set(prev); next.delete(id); return next; });
      return;
    }
    mutate((prev) => prev.map((e) => (e.id === id && e.type === "math" ? { ...e, props: { ...e.props, latex } } : e)));
  }

  /** A math box sizing itself to its rendered formula — layout, not an edit, so no undo step. */
  function measureMath(id: string, width: number, height: number) {
    applyMutation((prev) => prev.map((e) => (e.id === id && e.type === "math" ? { ...e, width, height } : e)));
  }

  function renameFrame(id: string, name: string) {
    mutate((prev) => prev.map((e) => (e.id === id && e.type === "frame" ? { ...e, props: { ...e.props, name } } : e)));
  }

  function startEdit(id: string) {
    setEditingId(id);
    setSelectedIds(new Set([id]));
  }

  /** A placed text/note box's own live properties — edited directly, not
   * routed through the ambient "next new element" defaults above. */
  function updateSelectedElement(updater: (el: CanvasElement) => CanvasElement) {
    if (!selectedId) return;
    mutate((prev) => prev.map((e) => (e.id === selectedId ? updater(e) : e)));
  }
  function setSelectedFontColor(c: string) {
    updateSelectedElement((e) => {
      if (e.type === "text") return { ...e, props: { ...e.props, color: c } };
      if (e.type === "note") return { ...e, props: { ...e.props, textColor: c } };
      return e;
    });
  }
  function setSelectedBackgroundColor(c: string | null) {
    updateSelectedElement((e) => {
      if (e.type === "text") return { ...e, props: { ...e.props, backgroundColor: c } };
      if (e.type === "note" && c !== null) return { ...e, props: { ...e.props, color: c } };
      return e;
    });
  }
  function setSelectedFontSize(category: WidthCategory) {
    const fontSize = FONT_SIZES[category];
    updateSelectedElement((e) => {
      if (e.type === "text") return { ...e, props: { ...e.props, fontSize } };
      if (e.type === "note") return { ...e, props: { ...e.props, fontSize } };
      return e;
    });
  }
  function setSelectedBold(b: boolean) {
    updateSelectedElement((e) => {
      if (e.type === "text") return { ...e, props: { ...e.props, bold: b } };
      if (e.type === "note") return { ...e, props: { ...e.props, bold: b } };
      return e;
    });
  }
  function setSelectedItalic(b: boolean) {
    updateSelectedElement((e) => {
      if (e.type === "text") return { ...e, props: { ...e.props, italic: b } };
      if (e.type === "note") return { ...e, props: { ...e.props, italic: b } };
      return e;
    });
  }
  function setSelectedOpacity(o: number) {
    if (!selectedId) return;
    applyMutation((prev) => prev.map((e) => (e.id === selectedId ? { ...e, opacity: o } : e)));
  }
  function setSelectedTextAlign(align: "left" | "center" | "right") {
    updateSelectedElement((e) => {
      if (e.type === "text") return { ...e, props: { ...e.props, textAlign: align } };
      if (e.type === "note") return { ...e, props: { ...e.props, textAlign: align } };
      return e;
    });
  }
  function setSelectedAutoFit(autoFit: "fixed" | "shrink" | "grow") {
    updateSelectedElement((e) => {
      if (e.type === "text") return { ...e, props: { ...e.props, autoFit } };
      if (e.type === "note") return { ...e, props: { ...e.props, autoFit } };
      return e;
    });
  }

  function handleFitToContent() {
    if (elementsRef.current.length === 0 || !svgRef.current) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const el of elementsRef.current) {
      minX = Math.min(minX, el.x); minY = Math.min(minY, el.y);
      maxX = Math.max(maxX, el.x + el.width); maxY = Math.max(maxY, el.y + el.height);
    }
    const rect = svgRef.current.getBoundingClientRect();
    const pad = 60;
    const contentW = maxX - minX + pad * 2, contentH = maxY - minY + pad * 2;
    const scale = Math.min(2.5, Math.max(0.2, Math.min(rect.width / contentW, rect.height / contentH)));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    setTransform(zoomIdentity.translate(rect.width / 2 - cx * scale, rect.height / 2 - cy * scale).scale(scale), 300);
  }

  function handleResetView() {
    setTransform(zoomIdentity, 300);
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
    setSelectedIds(new Set());
  }

  const canUndo = useMemo(() => historyRef.current.past.length > 0, [historyVersion]);
  const canRedo = useMemo(() => historyRef.current.future.length > 0, [historyVersion]);
  const sorted = useMemo(() => [...elements].sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0)), [elements]);

  const selectedElement = selectedId ? elements.find((e) => e.id === selectedId) ?? null : null;
  const isTextLikeSelected = selectedElement?.type === "text" || selectedElement?.type === "note";
  /** What Ask AI asks about: the marquees' area while it still describes the selection, else the selected elements' bounds. */
  const selectionArea = selectedIds.size === 0 ? null
    : marqueeArea?.ids === selectedIds ? marqueeArea.rect
    : boundsOf(elements.filter((e) => selectedIds.has(e.id)));

  const styleContext: StyleContext = {
    dash: !isTextLikeSelected && (tool === "line" || tool === "arrow" || tool === "shape" || tool === "draw" || tool === "highlighter"),
    fill: !isTextLikeSelected && tool === "shape",
    fontSize: isTextLikeSelected || tool === "text" || tool === "note" || tool === "math",
    text: isTextLikeSelected,
  };
  const showAmbientStylePanel = ["draw", "highlighter", "line", "arrow", "shape", "text", "note", "math"].includes(tool);
  const showStylePanel = showAmbientStylePanel || isTextLikeSelected;
  const now = Date.now();
  const visibleLaser = laserPoints.filter((p) => now - p.t < LASER_FADE_MS);
  const ink = aiInk(background.color);

  const panelColor = isTextLikeSelected ? getInkColor(selectedElement!) : color;
  const panelOnColorChange = isTextLikeSelected ? setSelectedFontColor : setColor;
  const panelWidthCategory = isTextLikeSelected ? categoryForFontSize(getFontSize(selectedElement!)) : widthCategory;
  const panelOnWidthChange = isTextLikeSelected ? setSelectedFontSize : setWidthCategory;
  const panelOpacity = isTextLikeSelected ? selectedElement!.opacity : opacity;
  const panelOnOpacityChange = isTextLikeSelected ? setSelectedOpacity : setOpacity;
  const panelOnOpacityDragStart = isTextLikeSelected ? snapshotHistory : undefined;
  const panelBackground = isTextLikeSelected ? getBgColor(selectedElement!) : null;
  const panelBold = isTextLikeSelected ? getBold(selectedElement!) : false;
  const panelItalic = isTextLikeSelected ? getItalic(selectedElement!) : false;
  const panelTextAlign = isTextLikeSelected ? getTextAlign(selectedElement!) : "left";
  const panelAutoFit = isTextLikeSelected ? getAutoFit(selectedElement!) : "grow";
  const allowNoBackground = isTextLikeSelected && selectedElement!.type === "text";

  return (
    <>
    <div className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-bg">
      <Toolbar
        tool={tool} onToolChange={setTool}
        locked={locked} onLockedChange={setLocked}
        shapeKind={shapeKind} onShapeKindChange={setShapeKind}
        eraserMode={eraserMode} onEraserModeChange={setEraserMode}
        eraserSize={eraserSize} onEraserSizeChange={setEraserSize}
        canUndo={canUndo} canRedo={canRedo}
        onUndo={handleUndo} onRedo={handleRedo}
        onUploadImage={handleUploadImage} onClearCanvas={handleClearCanvas}
      />

      <BottomPill
        zoomPercent={Math.round(transform.k * 100)}
        onZoomBy={zoomBy}
        onFitToContent={handleFitToContent}
        onResetView={handleResetView}
        backgroundPattern={background.pattern}
        onBackgroundPatternChange={updateBackgroundPattern}
      />

      {showStylePanel && (
        <StylePanel
          context={styleContext}
          color={panelColor} onColorChange={panelOnColorChange}
          widthCategory={panelWidthCategory} onWidthChange={panelOnWidthChange}
          opacity={panelOpacity} onOpacityChange={panelOnOpacityChange} onOpacityDragStart={panelOnOpacityDragStart}
          dash={dash} onDashChange={setDash}
          fillStyle={fillStyle} onFillStyleChange={setFillStyle}
          backgroundColor={panelBackground} onBackgroundColorChange={setSelectedBackgroundColor} allowNoBackground={allowNoBackground}
          bold={panelBold} onBoldChange={setSelectedBold} italic={panelItalic} onItalicChange={setSelectedItalic}
          textAlign={panelTextAlign} onTextAlignChange={setSelectedTextAlign}
          autoFit={panelAutoFit} onAutoFitChange={setSelectedAutoFit}
        />
      )}

      {conflict && (
        <div className="absolute right-3 top-20 z-10 rounded-md border border-red-300 bg-surface px-3 py-1.5 text-xs text-red-600 shadow dark:border-red-900 dark:text-red-400">
          This canvas changed elsewhere — reload to see the newest version.
        </div>
      )}
      {!conflict && saving && (
        <div className="absolute right-3 top-20 z-10 text-xs text-fg-muted">Saving…</div>
      )}

      {!chatOpen && (
        <button
          type="button"
          onClick={openChat}
          title="Canvas chat"
          aria-label="Canvas chat"
          className="absolute right-3 top-4 z-30 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface text-fg-muted shadow-lg hover:text-fg"
        >
          <MessageSquare size={18} />
        </button>
      )}

      {selectionArea && !marquee && !editingId && (
        <SelectionMenu
          screen={toScreenRect(selectionArea, transform)}
          canvasWidth={svgRef.current?.clientWidth ?? 0}
          onAsk={() => askAboutSelection(false)}
          onCheck={() => askAboutSelection(true)}
          onDelete={deleteSelected}
        />
      )}

      <svg
        ref={svgRef}
        width="100%" height="100%"
        className="flex-1 touch-none"
        // The AI's ink for this board's background, for its annotations (ElementRenderer.tsx).
        style={{ cursor: cursorForTool(tool), "--ai-ink": ink.ink, "--ai-ink-fg": ink.fg } as React.CSSProperties}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
          <BackgroundLayer background={background} />

          {sorted.map((el) => (
            <ElementShape
              key={el.id}
              element={el}
              selected={selectedIds.has(el.id)}
              soleSelected={el.id === selectedId}
              editing={el.id === editingId}
              onCommitText={commitText}
              onCommitMath={commitMath}
              onMeasureMath={measureMath}
              onRenameFrame={renameFrame}
              onStartEdit={startEdit}
              zoom={transform.k}
            />
          ))}

          {/* Frames and sticky notes show their own selected state. */}
          {sorted.filter((el) => selectedIds.has(el.id) && el.type !== "frame" && el.type !== "note").map((el) => (
            <SelectionOutline key={el.id} element={el} zoom={transform.k} />
          ))}

          {draft && draft.points.length > 1 && (
            <DraftStroke points={draft.points} color={color} highlighter={tool === "highlighter"} dash={dash} strokeWidth={STROKE_WIDTHS[widthCategory]} />
          )}

          {lineDraft && (
            <line x1={lineDraft.x1} y1={lineDraft.y1} x2={lineDraft.x2} y2={lineDraft.y2} stroke={color} strokeWidth={STROKE_WIDTHS[widthCategory]} strokeDasharray="4 3" />
          )}

          {boxDraft && tool === "shape" && <ShapeOutline shapeKind={shapeKind} {...boxDraft} />}
          {boxDraft && tool === "frame" && (
            <rect x={boxDraft.x} y={boxDraft.y} width={boxDraft.width} height={boxDraft.height} fill="none" className="stroke-accent" strokeWidth={1.5} strokeDasharray="4 3" />
          )}

          {marquee && (
            <rect
              data-testid="marquee"
              x={marquee.minX} y={marquee.minY} width={marquee.maxX - marquee.minX} height={marquee.maxY - marquee.minY}
              className="fill-accent/5 stroke-accent" strokeWidth={1.5} strokeDasharray="4 3" vectorEffect="non-scaling-stroke"
            />
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

    {chatOpen && (
      <CanvasChatPanel
        turns={chat.turns} busy={chat.busy} loadError={chat.loadError}
        attachment={attachment} onRemoveAttachment={() => setAttachment(null)}
        onSend={(text) => void sendToChat(text, attachment?.rect ?? null)}
        onClose={() => setChatOpen(false)}
      />
    )}
    </>
  );
}

/** Text/note prop accessors — the two element types put ink/paper on
 * differently-named fields (text: color=ink, backgroundColor=paper; note:
 * color=paper, textColor=ink), so the StylePanel wiring reads through these
 * rather than branching on element.type at every call site. */
function getInkColor(el: CanvasElement): string {
  if (el.type === "note") return el.props.textColor;
  if (el.type === "text") return el.props.color;
  return "#1c1b18";
}
function getBgColor(el: CanvasElement): string | null {
  if (el.type === "note") return el.props.color;
  if (el.type === "text") return el.props.backgroundColor;
  return null;
}
function getFontSize(el: CanvasElement): number {
  return el.type === "note" || el.type === "text" ? el.props.fontSize : 16;
}
function getBold(el: CanvasElement): boolean {
  return el.type === "note" || el.type === "text" ? el.props.bold : false;
}
function getItalic(el: CanvasElement): boolean {
  return el.type === "note" || el.type === "text" ? el.props.italic : false;
}
function getTextAlign(el: CanvasElement): "left" | "center" | "right" {
  return el.type === "note" || el.type === "text" ? el.props.textAlign : "left";
}
function getAutoFit(el: CanvasElement): "fixed" | "shrink" | "grow" {
  return el.type === "note" || el.type === "text" ? el.props.autoFit : "grow";
}
function categoryForFontSize(size: number): WidthCategory {
  let best: WidthCategory = "M";
  let bestDiff = Infinity;
  for (const [cat, val] of Object.entries(FONT_SIZES) as [WidthCategory, number][]) {
    const diff = Math.abs(val - size);
    if (diff < bestDiff) { bestDiff = diff; best = cat; }
  }
  return best;
}

/**
 * Reconciles a text/note box's stored size against what was actually typed:
 * "fixed" never touches either (text may clip — the deliberate escape
 * hatch); "grow" raises the box's height to fit (never shrinks a
 * manually-enlarged box); "shrink" keeps the box's own height and instead
 * scales the font down by how much the content overflowed, floored so text
 * never becomes unreadably small. The font-size scale-down is a one-pass
 * proportional estimate, not an iterative fit — wrapping is non-linear in
 * font size, so this can slightly over/undershoot, but gets close in one
 * step without re-measuring the DOM in a loop.
 */
function applyAutoFit(
  autoFit: "fixed" | "shrink" | "grow", currentHeight: number, currentFontSize: number, neededHeight: number,
): { height: number; fontSize: number } {
  if (autoFit === "grow") return { height: Math.max(currentHeight, neededHeight), fontSize: currentFontSize };
  if (autoFit === "shrink" && neededHeight > currentHeight && currentHeight > 0) {
    const ratio = currentHeight / neededHeight;
    return { height: currentHeight, fontSize: Math.max(MIN_AUTO_FIT_FONT_SIZE, Math.floor(currentFontSize * ratio)) };
  }
  return { height: currentHeight, fontSize: currentFontSize };
}

function DraftStroke({
  points, color, highlighter, dash, strokeWidth,
}: { points: DraftPoint[]; color: string; highlighter: boolean; dash: DashStyle; strokeWidth: number }) {
  // Local, live preview only — never persisted, so no SSR/hydration concern; safe to compute directly every render.
  if (dash !== "solid") {
    const d = strokeToPolylinePath(points);
    return (
      <path
        d={d} fill="none" stroke={color} strokeWidth={strokeWidth}
        strokeDasharray={dash === "dashed" ? `${strokeWidth * 3} ${strokeWidth * 2}` : `${strokeWidth} ${strokeWidth * 1.5}`}
        strokeLinecap="round" strokeLinejoin="round" opacity={highlighter ? 0.4 : 1}
      />
    );
  }
  const d = strokeToSvgPath({ points, color, strokeWidth, variant: highlighter ? "highlighter" : "pen", dash });
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
