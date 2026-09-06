import { describe, expect, it } from "vitest";
import { layoutTree } from "../lib/mindmaps/layout";

describe("layoutTree", () => {
  it("places the root at depth 0", () => {
    const nodes = [{ id: "root", label: "Root", parentId: null, note: null }];
    const positioned = layoutTree("root", nodes);
    expect(positioned).toHaveLength(1);
    expect(positioned[0]!.depth).toBe(0);
    expect(positioned[0]!.y).toBe(0);
  });

  it("children sit strictly below their parent", () => {
    const nodes = [
      { id: "root", label: "Root", parentId: null, note: null },
      { id: "a", label: "A", parentId: "root", note: null },
      { id: "b", label: "B", parentId: "root", note: null },
    ];
    const positioned = layoutTree("root", nodes);
    const root = positioned.find((n) => n.id === "root")!;
    const a = positioned.find((n) => n.id === "a")!;
    const b = positioned.find((n) => n.id === "b")!;
    expect(a.y).toBeGreaterThan(root.y);
    expect(b.y).toBeGreaterThan(root.y);
    expect(a.depth).toBe(1);
  });

  it("siblings never share the same x", () => {
    const nodes = [
      { id: "root", label: "Root", parentId: null, note: null },
      { id: "a", label: "A", parentId: "root", note: null },
      { id: "b", label: "B", parentId: "root", note: null },
      { id: "c", label: "C", parentId: "root", note: null },
    ];
    const positioned = layoutTree("root", nodes);
    const leafXs = positioned.filter((n) => n.id !== "root").map((n) => n.x);
    expect(new Set(leafXs).size).toBe(leafXs.length);
  });

  it("a parent centers over the horizontal span of its children", () => {
    const nodes = [
      { id: "root", label: "Root", parentId: null, note: null },
      { id: "a", label: "A", parentId: "root", note: null },
      { id: "a1", label: "A1", parentId: "a", note: null },
      { id: "a2", label: "A2", parentId: "a", note: null },
    ];
    const positioned = layoutTree("root", nodes);
    const a = positioned.find((n) => n.id === "a")!;
    const a1 = positioned.find((n) => n.id === "a1")!;
    const a2 = positioned.find((n) => n.id === "a2")!;
    expect(a.x).toBeCloseTo((a1.x + a2.x) / 2);
  });

  it("drops a node whose parent chain doesn't reach the root, rather than crashing", () => {
    const nodes = [
      { id: "root", label: "Root", parentId: null, note: null },
      { id: "orphan", label: "Orphan", parentId: "missing-parent", note: null },
    ];
    const positioned = layoutTree("root", nodes);
    expect(positioned.map((n) => n.id)).toEqual(["root"]);
  });

  it("handles a root with no children", () => {
    const nodes = [{ id: "root", label: "Root", parentId: null, note: null }];
    expect(() => layoutTree("root", nodes)).not.toThrow();
  });
});
