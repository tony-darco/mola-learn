"use client";

import { useMemo, useState } from "react";
import type { z } from "zod";
import type { mindMapPayloadSchema } from "@mola/shared";
import { layoutTree, LAYOUT_CONSTANTS, type MindMapNode } from "@/lib/mindmaps/layout";
import { updateMindMapAction } from "@/lib/mindmaps/actions";
import { renameArtifactAction } from "@/lib/artifacts/rename";

type Payload = z.infer<typeof mindMapPayloadSchema>;
const { NODE_WIDTH, NODE_HEIGHT } = LAYOUT_CONSTANTS;

/**
 * A real visual tree — boxes positioned by lib/mindmaps/layout.ts, connected
 * by SVG lines — not the outline-list rendering artifacts/MindMap.tsx uses
 * for a map that just landed inline in a chat turn (kept as-is; this is the
 * dedicated studying/editing surface, same split as Flashcards/Quizzes).
 * Click a node to select it; the side panel edits label/note, adds a child,
 * or deletes it (and its whole subtree).
 */
export function MindMapView({
  mapId, title: initialTitle, payload: initialPayload,
}: { mapId: string; title: string; payload: Payload }) {
  const [title, setTitle] = useState(initialTitle);
  const [editingTitle, setEditingTitle] = useState(false);
  const [payload, setPayload] = useState(initialPayload);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const positioned = useMemo(() => layoutTree(payload.rootId, payload.nodes), [payload]);
  const bounds = useMemo(() => {
    if (positioned.length === 0) return { minX: 0, maxX: NODE_WIDTH, maxY: NODE_HEIGHT };
    return {
      minX: Math.min(...positioned.map((n) => n.x)),
      maxX: Math.max(...positioned.map((n) => n.x)) + NODE_WIDTH,
      maxY: Math.max(...positioned.map((n) => n.y)) + NODE_HEIGHT,
    };
  }, [positioned]);
  const byId = useMemo(() => new Map(positioned.map((n) => [n.id, n])), [positioned]);
  const selected = selectedId ? payload.nodes.find((n) => n.id === selectedId) ?? null : null;

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

  function updateSelected(patch: Partial<MindMapNode>) {
    if (!selectedId) return;
    void persist({ ...payload, nodes: payload.nodes.map((n) => (n.id === selectedId ? { ...n, ...patch } : n)) });
  }

  function addChild() {
    if (!selectedId) return;
    const id = crypto.randomUUID();
    void persist({ ...payload, nodes: [...payload.nodes, { id, label: "New node", parentId: selectedId, note: null }] });
    setSelectedId(id);
  }

  function deleteSelected() {
    if (!selectedId || selectedId === payload.rootId) return; // the root can't be deleted from under itself
    // Remove the node and its whole subtree, plus any edge touching them.
    const toRemove = new Set<string>([selectedId]);
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
    setSelectedId(null);
  }

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

      <div className="flex gap-4">
        <div className="flex-1 overflow-auto rounded-xl border border-border bg-surface p-4">
          <svg
            width={bounds.maxX - bounds.minX + 40}
            height={bounds.maxY + 40}
            className="block"
          >
            <g transform={`translate(${20 - bounds.minX}, 20)`}>
              {/* Parent/child tree edges, drawn first so nodes sit on top. */}
              {positioned.filter((n) => n.parentId).map((n) => {
                const parent = byId.get(n.parentId!);
                if (!parent) return null;
                const x1 = parent.x + NODE_WIDTH / 2, y1 = parent.y + NODE_HEIGHT;
                const x2 = n.x + NODE_WIDTH / 2, y2 = n.y;
                return (
                  <path
                    key={`edge-${n.id}`}
                    d={`M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}`}
                    fill="none"
                    className="stroke-border"
                    strokeWidth={1.5}
                  />
                );
              })}

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

              {positioned.map((n) => (
                <g
                  key={n.id}
                  transform={`translate(${n.x}, ${n.y})`}
                  onClick={() => setSelectedId(n.id)}
                  className="cursor-pointer"
                >
                  <rect
                    width={NODE_WIDTH}
                    height={NODE_HEIGHT}
                    rx={10}
                    className={
                      n.id === selectedId
                        ? "fill-accent stroke-accent"
                        : n.id === payload.rootId
                          ? "fill-fg stroke-fg"
                          : "fill-bg stroke-border"
                    }
                    strokeWidth={1.5}
                  />
                  <foreignObject x={6} y={4} width={NODE_WIDTH - 12} height={NODE_HEIGHT - 8}>
                    <div
                      className={`flex h-full items-center justify-center overflow-hidden text-center text-xs leading-tight ${
                        n.id === selectedId
                          ? "text-accent-fg"
                          : n.id === payload.rootId
                            ? "text-bg"
                            : "text-fg"
                      }`}
                    >
                      {n.label}
                    </div>
                  </foreignObject>
                </g>
              ))}
            </g>
          </svg>
        </div>

        <div className="w-64 shrink-0 rounded-xl border border-border bg-surface p-4">
          {selected ? (
            <div className="flex flex-col gap-3">
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-muted">Label</div>
                <input
                  value={selected.label}
                  onChange={(e) => setPayload((p) => ({ ...p, nodes: p.nodes.map((n) => (n.id === selectedId ? { ...n, label: e.target.value } : n)) }))}
                  onBlur={() => updateSelected({ label: selected.label })}
                  className="w-full rounded-lg border border-border bg-bg px-2.5 py-2 text-sm text-fg focus:outline-none"
                />
              </div>
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-muted">Note</div>
                <textarea
                  value={selected.note ?? ""}
                  onChange={(e) => setPayload((p) => ({ ...p, nodes: p.nodes.map((n) => (n.id === selectedId ? { ...n, note: e.target.value || null } : n)) }))}
                  onBlur={() => updateSelected({ note: selected.note })}
                  rows={3}
                  className="w-full resize-y rounded-lg border border-border bg-bg px-2.5 py-2 text-sm text-fg focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={addChild}
                className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg hover:bg-surface"
              >
                + Add child node
              </button>
              {selected.id !== payload.rootId && (
                <button
                  type="button"
                  onClick={deleteSelected}
                  className="rounded-lg border border-red-300 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                >
                  Delete node (and its children)
                </button>
              )}
            </div>
          ) : (
            <div className="text-sm text-fg-muted">Click a node to edit it.</div>
          )}
        </div>
      </div>
    </div>
  );
}
