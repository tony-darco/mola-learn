"use client";

import type { mindMapPayloadSchema } from "@mola/shared";
import type { z } from "zod";

type Payload = z.infer<typeof mindMapPayloadSchema>;
type Node = Payload["nodes"][number];

/** Outline-tree rendering — no canvas/graph library, just nested indentation. */
export function MindMap({ payload, title }: { payload: Payload; title: string }) {
  const byParent = new Map<string | null, Node[]>();
  for (const node of payload.nodes) {
    const list = byParent.get(node.parentId) ?? [];
    list.push(node);
    byParent.set(node.parentId, list);
  }
  const root = payload.nodes.find((n) => n.id === payload.rootId);

  return (
    <div>
      <div className="mb-2.5 text-xs text-fg-muted">{title}</div>
      {root ? (
        <MindMapNode node={root} byParent={byParent} depth={0} />
      ) : (
        <div className="text-[13.5px] text-fg-muted">This mind map has no root node.</div>
      )}
      {payload.edges.length > 0 && (
        <div className="mt-3 border-t border-border pt-2">
          {payload.edges.map((e, i) => (
            <div key={i} className="text-[12.5px] text-fg-muted">
              {labelFor(payload.nodes, e.from)} → {labelFor(payload.nodes, e.to)}
              {e.label ? ` (${e.label})` : ""}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function labelFor(nodes: Node[], id: string): string {
  return nodes.find((n) => n.id === id)?.label ?? id;
}

function MindMapNode({ node, byParent, depth }: { node: Node; byParent: Map<string | null, Node[]>; depth: number }) {
  const children = byParent.get(node.id) ?? [];
  return (
    <div className="mb-1" style={{ marginLeft: depth * 18 }}>
      <div className="text-sm text-fg">{node.label}</div>
      {node.note && <div className="text-xs text-fg-muted">{node.note}</div>}
      {children.map((c) => (
        <MindMapNode key={c.id} node={c} byParent={byParent} depth={depth + 1} />
      ))}
    </div>
  );
}
