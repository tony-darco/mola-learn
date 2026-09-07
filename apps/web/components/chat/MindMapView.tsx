"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { z } from "zod";
import { AnimatePresence, animate, motion, motionValue, useTransform, type MotionValue } from "motion/react";
import { select } from "d3-selection";
import "d3-transition"; // augments Selection with `.transition()`, used by zoomBy()
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import type { mindMapPayloadSchema } from "@mola/shared";
import { layoutTree, LAYOUT_CONSTANTS, type MindMapNode } from "@/lib/mindmaps/layout";
import { updateMindMapAction } from "@/lib/mindmaps/actions";
import { renameArtifactAction } from "@/lib/artifacts/rename";

type Payload = z.infer<typeof mindMapPayloadSchema>;
const { NODE_WIDTH, NODE_HEIGHT, H_GAP } = LAYOUT_CONSTANTS;

const PANEL_MIN_WIDTH = 280;
const PANEL_MAX_WIDTH = 560;
const PANEL_DEFAULT_WIDTH = 360;
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 2.5;

/** Expand/collapse timing (NotebookLM-style: snappy, never past ~400ms). */
const MOVE_DURATION = 0.3;
const STAGGER_STEP = 0.05;

type NodeMotionEntry = { x: MotionValue<number>; y: MotionValue<number> };

/**
 * Depth-tiered palette matching the reference mock: root is the odd one out
 * (lavender), everything at depth 1 is blue, depth 2+ is green — the map can
 * go arbitrarily deep (no fixed number of levels), so anything past depth 2
 * just keeps the last tier rather than inventing more colors.
 */
const TIERS = [
  { bg: "#d9d6fb", border: "#b3adf5", text: "#2c2560" }, // root
  { bg: "#cfe3fb", border: "#a7cdf5", text: "#1c3f66" }, // depth 1
  { bg: "#c9f0dd", border: "#9ee3c2", text: "#154c34" }, // depth 2+
];
function tierFor(depth: number) {
  return TIERS[Math.min(depth, TIERS.length - 1)]!;
}

/**
 * A real visual tree — horizontal, left-to-right, collapsible per node, on
 * an infinite pan/zoom canvas (d3-zoom drives the gesture math; we only own
 * the resulting transform). Expand/collapse animates via motion's
 * AnimatePresence: a newly-visible child mounts growing out of its parent's
 * position, since layoutTree already omits collapsed descendants entirely —
 * toggling `collapsed` is a real mount/unmount, not just a style change.
 *
 * Clicking a node opens a fixed right-side panel (not an inline callout —
 * an in-flow panel would resize the canvas viewport every time it opens,
 * fighting a pan/zoom surface that wants a stable size) showing its
 * definition and the specific sources that node was grounded in.
 */
export function MindMapView({
  mapId, title: initialTitle, payload: initialPayload,
}: { mapId: string; title: string; payload: Payload }) {
  const [title, setTitle] = useState(initialTitle);
  const [editingTitle, setEditingTitle] = useState(false);
  const [payload, setPayload] = useState(initialPayload);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);

  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT_WIDTH);
  const [panelHandleHover, setPanelHandleHover] = useState(false);
  const panelDragStart = useRef<{ x: number; width: number } | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomBehaviorRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  const seededInitialTransform = useRef(false);

  const positioned = useMemo(() => layoutTree(payload.rootId, payload.nodes, collapsed), [payload, collapsed]);
  const bounds = useMemo(() => {
    if (positioned.length === 0) return { minY: 0, maxX: NODE_WIDTH, maxY: NODE_HEIGHT };
    return {
      minY: Math.min(...positioned.map((n) => n.y)),
      maxX: Math.max(...positioned.map((n) => n.x)) + NODE_WIDTH,
      maxY: Math.max(...positioned.map((n) => n.y)) + NODE_HEIGHT,
    };
  }, [positioned]);
  const byId = useMemo(() => new Map(positioned.map((n) => [n.id, n])), [positioned]);
  const open = openId ? payload.nodes.find((n) => n.id === openId) ?? null : null;

  // Persistent per-node position — plain motion values, not React state, so
  // an edge can live-track its endpoints every frame (via useTransform)
  // while a node glides, instead of snapping to the layout's final x/y.
  // Entries are created lazily during render (the one standard exception to
  // "no side effects in render" — see the React docs on lazy ref init) so a
  // brand-new node always has an entry to bind to on the very same render
  // that first includes it; the effect below only ever *animates* them.
  const nodeMotionRef = useRef<Map<string, NodeMotionEntry>>(new Map());
  const parentOfRef = useRef<Map<string, string | null>>(new Map());
  const prevVisibleIdsRef = useRef<Set<string>>(new Set());
  const newIdsThisRenderRef = useRef<Set<string>>(new Set());
  const hasMountedRef = useRef(false);
  // A departed node's entry is removed on a plain timer, not a Promise tied
  // to its shrink animation — a Promise from an *interrupted* animate() call
  // can resolve at an indeterminate point relative to a fast re-expand's own
  // render/effect, and by the time it does, deleting is no longer safe to
  // gate correctly (caught live: exactly this race stacked a re-expanded
  // node's whole subtree onto a stale position). A timer can be positively
  // cancelled the instant the node reappears — no ambiguity either way.
  const pendingDeleteRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const newIdsThisRender = new Set(positioned.filter((n) => !nodeMotionRef.current.has(n.id)).map((n) => n.id));
  newIdsThisRenderRef.current = newIdsThisRender;

  // Sibling stagger — only new arrivals cascade; a node just gliding to a new
  // spot because a sibling branch expanded/collapsed starts immediately.
  const staggerDelay = new Map<string, number>();
  {
    const counters = new Map<string, number>();
    for (const n of positioned) {
      if (!newIdsThisRender.has(n.id)) continue;
      const key = n.parentId ?? "__root__";
      const idx = counters.get(key) ?? 0;
      counters.set(key, idx + 1);
      staggerDelay.set(n.id, idx * STAGGER_STEP);
    }
  }

  for (const n of positioned) {
    // This node is visible again — if it was mid-shrink-to-parent from a
    // very recent collapse, cancel that pending removal outright rather
    // than trying to reason about whether an in-flight animation's promise
    // will resolve before or after this render's effect runs.
    const pendingDelete = pendingDeleteRef.current.get(n.id);
    if (pendingDelete !== undefined) {
      clearTimeout(pendingDelete);
      pendingDeleteRef.current.delete(n.id);
    }
    parentOfRef.current.set(n.id, n.parentId);
    if (!nodeMotionRef.current.has(n.id)) {
      const parentEntry = n.parentId ? nodeMotionRef.current.get(n.parentId) : null;
      // First paint ever: land directly on the final position, no animation
      // (mirrors the old AnimatePresence initial={false} behavior). Every
      // later arrival originates from its parent's CURRENT live position.
      const originX = hasMountedRef.current ? (parentEntry?.x.get() ?? n.x) : n.x;
      const originY = hasMountedRef.current ? (parentEntry?.y.get() ?? n.y) : n.y;
      nodeMotionRef.current.set(n.id, { x: motionValue(originX), y: motionValue(originY) });
    }
  }

  // Drive the actual motion — every visible node glides to its layout
  // target (covers both a freshly-arrived child AND an unrelated node just
  // reflowing because a sibling branch's size changed), and a node that
  // just left `positioned` keeps animating toward its former parent's
  // *current* position for the same duration before AnimatePresence
  // actually unmounts it, so its connector shrinks in step instead of
  // freezing mid-air.
  useEffect(() => {
    // React's Strict Mode (on by default in Next.js dev builds) double-
    // invokes every effect — mount, cleanup, mount again — to surface
    // exactly this class of bug. Without a cleanup that undoes what THIS
    // invocation started, the throwaway first pass's animate() calls and
    // the real second pass's calls both end up live at once, racing for
    // the same motion values (caught live: this alone reproduced the
    // "re-expanded branch stacks on the parent" bug even with `.stop()`
    // called before every `animate()` — the stop was correctly clearing
    // the *previous state update's* animation, but not a duplicate
    // invocation of this exact same one). Track exactly what this
    // invocation touches and reverse it on cleanup; in production, where
    // Strict Mode's double-invoke doesn't happen, this cleanup only ever
    // runs on the next real update or unmount, which is the normal case
    // `useEffect` cleanup is for anyway.
    const stoppedByThisRun: NodeMotionEntry[] = [];
    const timersByThisRun: { id: string; timer: ReturnType<typeof setTimeout> }[] = [];

    if (hasMountedRef.current) {
      for (const n of positioned) {
        const entry = nodeMotionRef.current.get(n.id);
        if (!entry) continue;
        const isArrival = newIdsThisRenderRef.current.has(n.id);
        const delay = isArrival ? staggerDelay.get(n.id) ?? 0 : 0;
        entry.x.stop();
        entry.y.stop();
        animate(entry.x, n.x, { duration: MOVE_DURATION, ease: "easeOut", delay });
        animate(entry.y, n.y, { duration: MOVE_DURATION, ease: "easeOut", delay });
        stoppedByThisRun.push(entry);
      }
      const currentIds = new Set(positioned.map((n) => n.id));
      for (const id of prevVisibleIdsRef.current) {
        if (currentIds.has(id)) continue;
        const entry = nodeMotionRef.current.get(id);
        const parentId = parentOfRef.current.get(id) ?? null;
        const parentEntry = parentId ? nodeMotionRef.current.get(parentId) : null;
        if (!entry || !parentEntry) continue;
        entry.x.stop();
        entry.y.stop();
        animate(entry.x, parentEntry.x.get(), { duration: MOVE_DURATION, ease: "easeIn" });
        animate(entry.y, parentEntry.y.get(), { duration: MOVE_DURATION, ease: "easeIn" });
        stoppedByThisRun.push(entry);
        // Drop the entry once the shrink would have finished — otherwise
        // re-expanding this branch later would reuse a stale entry frozen
        // at wherever the parent was at collapse time instead of being
        // treated as a fresh arrival. Cancelled the instant this id
        // reappears in `positioned` (in the lazy-init pass above).
        const timer = setTimeout(() => {
          pendingDeleteRef.current.delete(id);
          nodeMotionRef.current.delete(id);
          parentOfRef.current.delete(id);
        }, MOVE_DURATION * 1000);
        pendingDeleteRef.current.set(id, timer);
        timersByThisRun.push({ id, timer });
      }
    }
    prevVisibleIdsRef.current = new Set(positioned.map((n) => n.id));
    hasMountedRef.current = true;

    return () => {
      for (const entry of stoppedByThisRun) {
        entry.x.stop();
        entry.y.stop();
      }
      for (const { id, timer } of timersByThisRun) {
        clearTimeout(timer);
        if (pendingDeleteRef.current.get(id) === timer) pendingDeleteRef.current.delete(id);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on layout targets only; staggerDelay is derived from the same `positioned` each render.
  }, [positioned]);

  // Zoom behavior — wired once. Panning/zooming updates React state so the
  // content <g> re-renders with the new transform; the +/- buttons and the
  // gesture handlers below all go back through this same behavior so d3's
  // internal transform never drifts out of sync with what's on screen.
  useEffect(() => {
    if (!svgRef.current) return;
    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([ZOOM_MIN, ZOOM_MAX])
      .on("zoom", (event) => setTransform(event.transform));
    select(svgRef.current).call(behavior);
    zoomBehaviorRef.current = behavior;
    return () => {
      select(svgRef.current!).on(".zoom", null);
      zoomBehaviorRef.current = null;
    };
  }, []);

  // Seed the initial view once real layout bounds exist, so the first paint
  // matches the old static top-left placement — never re-seeded afterward,
  // so collapsing/expanding a node never recenters or resets the view.
  useEffect(() => {
    if (seededInitialTransform.current || positioned.length === 0 || !svgRef.current || !zoomBehaviorRef.current) return;
    seededInitialTransform.current = true;
    const seed = zoomIdentity.translate(20, 20 - bounds.minY);
    select(svgRef.current).call(zoomBehaviorRef.current.transform, seed);
  }, [positioned.length, bounds.minY]);

  function zoomBy(factor: number) {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    select(svgRef.current).transition().duration(200).call(zoomBehaviorRef.current.scaleBy, factor);
  }

  function toggleCollapsed(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function commitTitle() {
    setEditingTitle(false);
    const trimmed = title.trim();
    if (!trimmed) { setTitle(initialTitle); return; }
    if (trimmed === initialTitle) return;
    void renameArtifactAction(mapId, trimmed, "mind_map", "/mindmaps");
  }

  async function persist(next: Payload) {
    setPayload(next);
    setSaving(true);
    try {
      await updateMindMapAction(mapId, next.rootId, next.nodes, next.edges);
    } finally {
      setSaving(false);
    }
  }

  function updateOpen(patch: Partial<MindMapNode>) {
    if (!openId) return;
    void persist({ ...payload, nodes: payload.nodes.map((n) => (n.id === openId ? { ...n, ...patch } : n)) });
  }

  function addChild() {
    if (!openId) return;
    const id = crypto.randomUUID();
    void persist({ ...payload, nodes: [...payload.nodes, { id, label: "New node", parentId: openId, note: null, sources: [] }] });
    setOpenId(id);
    setEditMode(true);
  }

  function deleteOpen() {
    if (!openId || openId === payload.rootId) return; // the root can't be deleted from under itself
    const toRemove = new Set<string>([openId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const n of payload.nodes) {
        if (n.parentId && toRemove.has(n.parentId) && !toRemove.has(n.id)) {
          toRemove.add(n.id);
          grew = true;
        }
      }
    }
    void persist({
      ...payload,
      nodes: payload.nodes.filter((n) => !toRemove.has(n.id)),
      edges: payload.edges.filter((e) => !toRemove.has(e.from) && !toRemove.has(e.to)),
    });
    setOpenId(null);
    setEditMode(false);
  }

  function startPanelDrag(e: React.PointerEvent) {
    panelDragStart.current = { x: e.clientX, width: panelWidth };
    window.addEventListener("pointermove", onPanelPointerMove);
    window.addEventListener("pointerup", onPanelPointerUp);
  }
  function onPanelPointerMove(e: PointerEvent) {
    if (!panelDragStart.current) return;
    // Panel is right-anchored — dragging left (negative clientX delta) widens it.
    const delta = panelDragStart.current.x - e.clientX;
    setPanelWidth(Math.min(Math.max(panelDragStart.current.width + delta, PANEL_MIN_WIDTH), PANEL_MAX_WIDTH));
  }
  function onPanelPointerUp() {
    panelDragStart.current = null;
    window.removeEventListener("pointermove", onPanelPointerMove);
    window.removeEventListener("pointerup", onPanelPointerUp);
  }
  useEffect(() => () => {
    window.removeEventListener("pointermove", onPanelPointerMove);
    window.removeEventListener("pointerup", onPanelPointerUp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        {editingTitle ? (
          <input
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
              if (e.key === "Escape") { e.preventDefault(); setTitle(initialTitle); setEditingTitle(false); }
            }}
            aria-label="Mind map title"
            className="w-full rounded-lg border border-border bg-bg px-2 py-1 text-2xl font-semibold text-fg focus:outline-none"
          />
        ) : (
          <h1
            className="cursor-text rounded-lg px-2 py-1 text-2xl font-semibold text-fg hover:bg-surface"
            onClick={() => setEditingTitle(true)}
            title="Click to rename"
          >
            {title}
          </h1>
        )}
        {saving && <div className="shrink-0 text-xs text-fg-muted">Saving…</div>}
      </div>

      <div className="relative h-[70vh] overflow-hidden rounded-xl border border-border bg-white dark:bg-surface">
        <svg ref={svgRef} width="100%" height="100%" className="block cursor-grab active:cursor-grabbing">
          <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.k})`}>
            {/* Parent -> child tree edges, anchored on the arrow position (not
                the node box). Each edge's `d` is a MotionValue derived live
                from both endpoints' motion values, so it stays in sync frame
                by frame while either node glides — on arrival, on reflow,
                and on collapse (drawn first so nodes/arrows sit on top). */}
            <AnimatePresence initial={false}>
              {positioned.filter((n) => n.parentId).map((n) => {
                const parentEntry = nodeMotionRef.current.get(n.parentId!);
                const childEntry = nodeMotionRef.current.get(n.id);
                if (!parentEntry || !childEntry) return null;
                return <MindMapEdge key={`edge-${n.id}`} parent={parentEntry} child={childEntry} />;
              })}
            </AnimatePresence>

            {/* Cross-links — dashed, labeled, distinct from the tree spine. */}
            {payload.edges.map((e, i) => {
              const from = byId.get(e.from), to = byId.get(e.to);
              if (!from || !to) return null;
              const x1 = from.x + NODE_WIDTH / 2, y1 = from.y + NODE_HEIGHT / 2;
              const x2 = to.x + NODE_WIDTH / 2, y2 = to.y + NODE_HEIGHT / 2;
              return (
                <g key={`cross-${i}`}>
                  <line x1={x1} y1={y1} x2={x2} y2={y2} className="stroke-accent" strokeWidth={1.25} strokeDasharray="4 3" opacity={0.6} />
                  {e.label && (
                    <text x={(x1 + x2) / 2} y={(y1 + y2) / 2} className="fill-fg-muted text-[10px]" textAnchor="middle">
                      {e.label}
                    </text>
                  )}
                </g>
              );
            })}

            <AnimatePresence initial={false}>
              {positioned.map((n) => {
                const tier = tierFor(n.depth);
                const isCollapsedHere = collapsed.has(n.id);
                const entry = nodeMotionRef.current.get(n.id);
                if (!entry) return null;
                const delay = staggerDelay.get(n.id) ?? 0;
                return (
                  <motion.g
                    key={n.id}
                    style={{ x: entry.x, y: entry.y }}
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0, transition: { duration: MOVE_DURATION, ease: "easeIn" } }}
                    transition={{ duration: MOVE_DURATION, ease: "easeOut", delay }}
                  >
                    <rect
                      width={NODE_WIDTH}
                      height={NODE_HEIGHT}
                      rx={10}
                      fill={tier.bg}
                      stroke={n.id === openId ? tier.text : tier.border}
                      strokeWidth={n.id === openId ? 2 : 1.5}
                      className="cursor-pointer"
                      onClick={() => setOpenId((cur) => (cur === n.id ? null : n.id))}
                    />
                    <foreignObject
                      x={8} y={4} width={NODE_WIDTH - 16} height={NODE_HEIGHT - 8}
                      className="pointer-events-none"
                    >
                      <div
                        className="flex h-full items-center justify-center overflow-hidden text-center text-[13px] font-medium leading-tight"
                        style={{ color: tier.text }}
                      >
                        {n.label}
                      </div>
                    </foreignObject>

                    {n.hasChildren && (
                      <g
                        transform={`translate(${NODE_WIDTH + H_GAP / 2}, ${NODE_HEIGHT / 2})`}
                        className="cursor-pointer"
                        onClick={() => toggleCollapsed(n.id)}
                      >
                        <circle r={10} fill="#eef1f6" stroke="#a6b0c3" strokeWidth={1} />
                        <text
                          textAnchor="middle"
                          dominantBaseline="central"
                          className="select-none fill-[#4b5566] text-[11px]"
                        >
                          {isCollapsedHere ? "›" : "‹"}
                        </text>
                      </g>
                    )}
                  </motion.g>
                );
              })}
            </AnimatePresence>
          </g>
        </svg>

        <div className="absolute bottom-3 right-3 flex flex-col gap-1">
          <button
            type="button"
            onClick={() => zoomBy(1.3)}
            aria-label="Zoom in"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface text-fg shadow hover:bg-bg"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => zoomBy(1 / 1.3)}
            aria-label="Zoom out"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface text-fg shadow hover:bg-bg"
          >
            −
          </button>
        </div>

        {open && (
          <div
            className="fixed right-0 top-0 z-50 h-full overflow-y-auto border-l border-border bg-surface p-5 shadow-2xl"
            style={{ width: panelWidth }}
          >
            <div
              onPointerDown={startPanelDrag}
              onPointerEnter={() => setPanelHandleHover(true)}
              onPointerLeave={() => setPanelHandleHover(false)}
              className="absolute inset-y-0 left-0 z-10 w-3 cursor-col-resize"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize node panel"
            >
              {panelHandleHover && <div className="absolute inset-y-0 left-1 w-0.5 bg-accent" />}
            </div>

            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-fg">{open.label}</h2>
              <button
                type="button"
                onClick={() => { setOpenId(null); setEditMode(false); }}
                aria-label="Close"
                className="shrink-0 rounded-md px-1.5 py-0.5 text-fg-muted hover:bg-bg hover:text-fg"
              >
                ✕
              </button>
            </div>

            {editMode ? (
              <div className="flex flex-col gap-3">
                <div>
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-muted">Label</div>
                  <input
                    value={open.label}
                    onChange={(e) => setPayload((p) => ({ ...p, nodes: p.nodes.map((n) => (n.id === openId ? { ...n, label: e.target.value } : n)) }))}
                    onBlur={() => updateOpen({ label: open.label })}
                    className="w-full rounded-lg border border-border bg-bg px-2.5 py-2 text-sm text-fg focus:outline-none"
                  />
                </div>
                <div>
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-muted">Definition</div>
                  <textarea
                    value={open.note ?? ""}
                    onChange={(e) => setPayload((p) => ({ ...p, nodes: p.nodes.map((n) => (n.id === openId ? { ...n, note: e.target.value || null } : n)) }))}
                    onBlur={() => updateOpen({ note: open.note })}
                    rows={3}
                    className="w-full resize-y rounded-lg border border-border bg-bg px-2.5 py-2 text-sm text-fg focus:outline-none"
                  />
                </div>
                <SourcesList sources={open.sources} />
                <div className="flex gap-2">
                  <button type="button" onClick={() => setEditMode(false)} className="flex-1 rounded-lg border border-border bg-bg px-3 py-1.5 text-sm text-fg hover:bg-surface">
                    Done
                  </button>
                  <button type="button" onClick={addChild} className="flex-1 rounded-lg border border-border bg-bg px-3 py-1.5 text-sm text-fg hover:bg-surface">
                    + Child
                  </button>
                  {open.id !== payload.rootId && (
                    <button type="button" onClick={deleteOpen} className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950">
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="text-sm text-fg-muted">{open.note ?? "No definition yet."}</div>
                <SourcesList sources={open.sources} />
                <button
                  type="button"
                  onClick={() => setEditMode(true)}
                  className="mt-1 self-start text-xs text-accent hover:underline"
                >
                  Edit
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A tree edge whose path data is a MotionValue<string>, recomputed every
 * frame from its two endpoints' live motion values — this is what makes the
 * connector "draw in" as a new child arrives (it starts at zero length, both
 * endpoints coincident at the parent) and shrink back on collapse, rather
 * than snapping to a straight line the instant positions change.
 */
function MindMapEdge({ parent, child }: { parent: NodeMotionEntry; child: NodeMotionEntry }) {
  const d = useTransform([parent.x, parent.y, child.x, child.y], (latest: number[]) => {
    const [px, py, cx, cy] = latest;
    const x1 = px! + NODE_WIDTH + H_GAP / 2, y1 = py! + NODE_HEIGHT / 2;
    const x2 = cx!, y2 = cy! + NODE_HEIGHT / 2;
    return `M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`;
  });
  return (
    <motion.path
      d={d}
      fill="none"
      stroke="#a6b0c3"
      strokeWidth={1.5}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: MOVE_DURATION, ease: "easeIn" } }}
      transition={{ duration: MOVE_DURATION * 0.6 }}
    />
  );
}

function SourcesList({ sources }: { sources: MindMapNode["sources"] }) {
  return (
    <div className="mt-1">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-muted">Sources</div>
      {sources.length === 0 ? (
        <div className="text-sm text-fg-muted">No sources recorded for this node.</div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {sources.map((s, i) => (
            <li key={i} className="text-sm text-fg">
              {s.documentTitle}{s.locator ? ` — ${s.locator}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
