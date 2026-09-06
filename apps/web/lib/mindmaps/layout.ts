/**
 * Pure tree-layout math for the mind map viewer — computes an (x, y) position
 * per node so MindMapView can render real boxes-and-lines SVG instead of an
 * outline list. No layout library: a mind map is a tree (plus a few cross-
 * edges), and a plain recursive layout is a well-understood, easily-tested
 * problem that doesn't need a dependency.
 */

export type MindMapNode = { id: string; label: string; parentId: string | null; note: string | null };

export type PositionedNode = MindMapNode & { x: number; y: number; depth: number };

const NODE_WIDTH = 160;
const NODE_HEIGHT = 44;
const H_GAP = 24;
const V_GAP = 70;

/**
 * Classic Reingold-Tilford-lite: each leaf gets one "slot" of width
 * NODE_WIDTH+H_GAP; an internal node centers over the span of its children.
 * Depth maps directly to y. Returns null positions are never produced —
 * a node with a parentId that isn't in the tree is simply not reachable and
 * won't appear (callers should validate structural integrity before this,
 * as emit_mind_map's execute() already does at creation time).
 */
export function layoutTree(rootId: string, nodes: MindMapNode[]): PositionedNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const childrenOf = new Map<string, MindMapNode[]>();
  for (const n of nodes) {
    if (n.parentId === null) continue;
    const list = childrenOf.get(n.parentId) ?? [];
    list.push(n);
    childrenOf.set(n.parentId, list);
  }

  const positions = new Map<string, { x: number; y: number; depth: number }>();
  let nextSlot = 0;

  function place(nodeId: string, depth: number): number {
    const children = childrenOf.get(nodeId) ?? [];
    if (children.length === 0) {
      const x = nextSlot * (NODE_WIDTH + H_GAP);
      nextSlot += 1;
      positions.set(nodeId, { x, y: depth * (NODE_HEIGHT + V_GAP), depth });
      return x;
    }
    const childXs = children.map((c) => place(c.id, depth + 1));
    const x = (Math.min(...childXs) + Math.max(...childXs)) / 2;
    positions.set(nodeId, { x, y: depth * (NODE_HEIGHT + V_GAP), depth });
    return x;
  }

  const root = byId.get(rootId);
  if (root) place(rootId, 0);

  return nodes
    .filter((n) => positions.has(n.id))
    .map((n) => ({ ...n, ...positions.get(n.id)! }));
}

export const LAYOUT_CONSTANTS = { NODE_WIDTH, NODE_HEIGHT, H_GAP, V_GAP };
