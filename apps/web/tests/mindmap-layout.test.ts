import { describe, expect, it } from "vitest";
import { layoutTree, type MindMapNode } from "../lib/mindmaps/layout";

/** Fixture shorthand — every test cares about id/label/parentId, almost none care about note/sources. */
function node(over: Pick<MindMapNode, "id" | "label" | "parentId"> & Partial<MindMapNode>): MindMapNode {
  return { note: null, sources: [], ...over };
}

describe("layoutTree", () => {
  it("places the root at depth 0", () => {
    const nodes = [node({ id: "root", label: "Root", parentId: null })];
    const positioned = layoutTree("root", nodes);
    expect(positioned).toHaveLength(1);
    expect(positioned[0]!.depth).toBe(0);
    expect(positioned[0]!.x).toBe(0);
  });

  it("children sit strictly to the right of their parent (horizontal, left-to-right)", () => {
    const nodes = [
      node({ id: "root", label: "Root", parentId: null }),
      node({ id: "a", label: "A", parentId: "root" }),
      node({ id: "b", label: "B", parentId: "root" }),
    ];
    const positioned = layoutTree("root", nodes);
    const root = positioned.find((n) => n.id === "root")!;
    const a = positioned.find((n) => n.id === "a")!;
    const b = positioned.find((n) => n.id === "b")!;
    expect(a.x).toBeGreaterThan(root.x);
    expect(b.x).toBeGreaterThan(root.x);
    expect(a.depth).toBe(1);
  });

  it("siblings never share the same y", () => {
    const nodes = [
      node({ id: "root", label: "Root", parentId: null }),
      node({ id: "a", label: "A", parentId: "root" }),
      node({ id: "b", label: "B", parentId: "root" }),
      node({ id: "c", label: "C", parentId: "root" }),
    ];
    const positioned = layoutTree("root", nodes);
    const leafYs = positioned.filter((n) => n.id !== "root").map((n) => n.y);
    expect(new Set(leafYs).size).toBe(leafYs.length);
  });

  it("a parent centers over the vertical span of its children", () => {
    const nodes = [
      node({ id: "root", label: "Root", parentId: null }),
      node({ id: "a", label: "A", parentId: "root" }),
      node({ id: "a1", label: "A1", parentId: "a" }),
      node({ id: "a2", label: "A2", parentId: "a" }),
    ];
    const positioned = layoutTree("root", nodes);
    const a = positioned.find((n) => n.id === "a")!;
    const a1 = positioned.find((n) => n.id === "a1")!;
    const a2 = positioned.find((n) => n.id === "a2")!;
    expect(a.y).toBeCloseTo((a1.y + a2.y) / 2);
  });

  it("drops a node whose parent chain doesn't reach the root, rather than crashing", () => {
    const nodes = [
      node({ id: "root", label: "Root", parentId: null }),
      node({ id: "orphan", label: "Orphan", parentId: "missing-parent" }),
    ];
    const positioned = layoutTree("root", nodes);
    expect(positioned.map((n) => n.id)).toEqual(["root"]);
  });

  it("handles a root with no children", () => {
    const nodes = [node({ id: "root", label: "Root", parentId: null })];
    expect(() => layoutTree("root", nodes)).not.toThrow();
  });

  it("flags hasChildren correctly regardless of collapse state", () => {
    const nodes = [
      node({ id: "root", label: "Root", parentId: null }),
      node({ id: "a", label: "A", parentId: "root" }),
      node({ id: "leaf", label: "Leaf", parentId: "a" }),
    ];
    const positioned = layoutTree("root", nodes);
    expect(positioned.find((n) => n.id === "root")!.hasChildren).toBe(true);
    expect(positioned.find((n) => n.id === "a")!.hasChildren).toBe(true);
    expect(positioned.find((n) => n.id === "leaf")!.hasChildren).toBe(false);
  });

  it("a collapsed node's descendants are omitted entirely", () => {
    const nodes = [
      node({ id: "root", label: "Root", parentId: null }),
      node({ id: "a", label: "A", parentId: "root" }),
      node({ id: "a1", label: "A1", parentId: "a" }),
      node({ id: "a2", label: "A2", parentId: "a" }),
      node({ id: "b", label: "B", parentId: "root" }),
    ];
    const positioned = layoutTree("root", nodes, new Set(["a"]));
    expect(positioned.map((n) => n.id).sort()).toEqual(["a", "b", "root"]);
    // "a" still reports it has children, so the view knows to render an
    // expand affordance even though they're currently hidden.
    expect(positioned.find((n) => n.id === "a")!.hasChildren).toBe(true);
  });

  it("collapsing a branch shrinks the layout instead of leaving a gap", () => {
    const nodes = [
      node({ id: "root", label: "Root", parentId: null }),
      node({ id: "a", label: "A", parentId: "root" }),
      node({ id: "a1", label: "A1", parentId: "a" }),
      node({ id: "a2", label: "A2", parentId: "a" }),
      node({ id: "a3", label: "A3", parentId: "a" }),
      node({ id: "b", label: "B", parentId: "root" }),
    ];
    const expanded = layoutTree("root", nodes);
    const collapsed = layoutTree("root", nodes, new Set(["a"]));
    const bExpanded = expanded.find((n) => n.id === "b")!;
    const bCollapsed = collapsed.find((n) => n.id === "b")!;
    expect(Math.abs(bCollapsed.y - collapsed.find((n) => n.id === "a")!.y))
      .toBeLessThan(Math.abs(bExpanded.y - expanded.find((n) => n.id === "a")!.y));
  });

  it("carries a node's sources through the layout untouched", () => {
    const sources = [{ documentId: "11111111-1111-1111-1111-111111111111", documentTitle: "Doc", locator: "ch.1", chunkOrdinals: [1] }];
    const nodes = [
      node({ id: "root", label: "Root", parentId: null }),
      node({ id: "a", label: "A", parentId: "root", sources }),
    ];
    const positioned = layoutTree("root", nodes);
    expect(positioned.find((n) => n.id === "a")!.sources).toEqual(sources);
  });
});
