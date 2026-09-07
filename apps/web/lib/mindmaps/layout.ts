/**
 * Pure tree-layout math for the mind map viewer — computes an (x, y) position
 * per node so MindMapView can render real boxes-and-lines SVG instead of an
 * outline list. No layout library: a mind map is a tree (plus a few cross-
 * edges), and a plain recursive layout is a well-understood, easily-tested
 * problem that doesn't need a dependency.
 *
 * Horizontal, left-to-right orientation (depth -> x, sibling order -> y) —
 * the mind-map convention, not a top-down org-chart. A `collapsed` set of
 * node ids lets a caller fold a subtree: a collapsed node's descendants are
 * simply left out of both the slot-counting and the returned positions, so
 * hiding a huge branch also shrinks the layout instead of leaving a gap.
 */

import type { SourceRef } from "@mola/shared";

export type MindMapNode = {
  id: string; label: string; parentId: string | null; note: string | null;
  sources: SourceRef[];
};

export type PositionedNode = MindMapNode & { x: number; y: number; depth: number; hasChildren: boolean };

const NODE_WIDTH = 180;
const NODE_HEIGHT = 44;
const H_GAP = 64;
const V_GAP = 20;

/**
 * Classic Reingold-Tilford-lite, rotated: each visible leaf gets one "slot"
 * of height NODE_HEIGHT+V_GAP; an internal node centers over the span of its
 * visible children. Depth maps directly to x. A node inside `collapsed` is
 * still placed itself, but its children are treated as absent — they never
 * reach `positions`, so they never appear in the returned array.
 */
export function layoutTree(
  rootId: string,
  nodes: MindMapNode[],
  collapsed: ReadonlySet<string> = new Set(),
): PositionedNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const childrenOf = new Map<string, MindMapNode[]>();
  for (const n of nodes) {
    if (n.parentId === null) continue;
    const list = childrenOf.get(n.parentId) ?? [];
    list.push(n);
    childrenOf.set(n.parentId, list);
  }

  const positions = new Map<string, { x: number; y: number; depth: number; hasChildren: boolean }>();
  let nextSlot = 0;

  function place(nodeId: string, depth: number): number {
    const allChildren = childrenOf.get(nodeId) ?? [];
    const visibleChildren = collapsed.has(nodeId) ? [] : allChildren;

    if (visibleChildren.length === 0) {
      const y = nextSlot * (NODE_HEIGHT + V_GAP);
      nextSlot += 1;
      positions.set(nodeId, { x: depth * (NODE_WIDTH + H_GAP), y, depth, hasChildren: allChildren.length > 0 });
      return y;
    }
    const childYs = visibleChildren.map((c) => place(c.id, depth + 1));
    const y = (Math.min(...childYs) + Math.max(...childYs)) / 2;
    positions.set(nodeId, { x: depth * (NODE_WIDTH + H_GAP), y, depth, hasChildren: allChildren.length > 0 });
    return y;
  }

  const root = byId.get(rootId);
  if (root) place(rootId, 0);

  return nodes
    .filter((n) => positions.has(n.id))
    .map((n) => ({ ...n, ...positions.get(n.id)! }));
}

export const LAYOUT_CONSTANTS = { NODE_WIDTH, NODE_HEIGHT, H_GAP, V_GAP };
