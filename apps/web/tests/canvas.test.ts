import { describe, expect, it } from "vitest";
import { canvasPayloadSchema, type CanvasElement } from "@mola/shared";
import { nextIndexAfterAll } from "../lib/canvas/order";
import { recomputeParentIds, deleteElement } from "../lib/canvas/membership";
import { finalizeStroke } from "../lib/canvas/stroke";

function draw(over: Partial<CanvasElement> & { id: string; index: string }): CanvasElement {
  return {
    parentId: null, x: 0, y: 0, width: 10, height: 10, rotation: 0, opacity: 1, createdBy: "user",
    type: "draw",
    props: { points: [{ x: 0, y: 0 }, { x: 5, y: 5 }], color: "#000", strokeWidth: 2, variant: "pen" },
    ...over,
  } as CanvasElement;
}

function frame(over: Partial<CanvasElement> & { id: string; index: string }): CanvasElement {
  return {
    parentId: null, x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1, createdBy: "user",
    type: "frame",
    props: { name: "Untitled frame" },
    ...over,
  } as CanvasElement;
}

describe("nextIndexAfterAll", () => {
  it("returns a key on an empty array", () => {
    expect(nextIndexAfterAll([])).toBeTruthy();
  });

  it("sorts after every existing key on a single-element array", () => {
    const first = nextIndexAfterAll([]);
    const second = nextIndexAfterAll([{ index: first }]);
    expect(second > first).toBe(true);
  });

  it("sorts after every existing key on a many-element array", () => {
    let keys: string[] = [];
    for (let i = 0; i < 20; i++) keys.push(nextIndexAfterAll(keys.map((index) => ({ index }))));
    for (let i = 1; i < keys.length; i++) {
      expect(keys[i]! > keys[i - 1]!).toBe(true);
    }
  });

  it("a shuffled array of keys sorted with plain < reproduces creation order", () => {
    let keys: string[] = [];
    for (let i = 0; i < 10; i++) keys.push(nextIndexAfterAll(keys.map((index) => ({ index }))));
    const shuffled = [...keys].sort(() => Math.random() - 0.5);
    const resorted = [...shuffled].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(resorted).toEqual(keys);
  });
});

describe("canvasPayloadSchema", () => {
  it("round-trips a fixture with all three element types, including a parented draw child", () => {
    const f = frame({ id: "f1", index: "a0" });
    const d = draw({ id: "d1", index: "a1", parentId: "f1", x: 10, y: 10 });
    const t = {
      id: "t1", index: "a2", parentId: null, x: 0, y: 0, width: 80, height: 24, rotation: 0,
      createdBy: "user" as const, type: "text" as const,
      props: { text: "hello", color: "#000", fontSize: 14 },
    };
    const payload = { kind: "canvas" as const, elements: [f, d, t], viewport: { x: 0, y: 0, zoom: 1 } };
    const parsed = canvasPayloadSchema.parse(payload);
    expect(parsed.elements).toHaveLength(3);
    expect(parsed.elements.find((e) => e.id === "d1")?.parentId).toBe("f1");
  });

  it("rejects negative width/height", () => {
    const bad = frame({ id: "f1", index: "a0", width: -1 });
    expect(() =>
      canvasPayloadSchema.parse({ kind: "canvas", elements: [bad], viewport: { x: 0, y: 0, zoom: 1 } }),
    ).toThrow();
  });

  it("rejects a missing discriminant", () => {
    const { type: _type, ...noType } = draw({ id: "d1", index: "a0" }) as CanvasElement & { type: string };
    expect(() =>
      canvasPayloadSchema.parse({ kind: "canvas", elements: [noType], viewport: { x: 0, y: 0, zoom: 1 } }),
    ).toThrow();
  });

  it("rejects an unknown type value", () => {
    const bad = { ...draw({ id: "d1", index: "a0" }), type: "sticky" };
    expect(() =>
      canvasPayloadSchema.parse({ kind: "canvas", elements: [bad], viewport: { x: 0, y: 0, zoom: 1 } }),
    ).toThrow();
  });

  it("relative draw points reconstruct to the correct absolute points", () => {
    const el = draw({
      id: "d1", index: "a0", x: 100, y: 200,
      props: { points: [{ x: 0, y: 0 }, { x: 5, y: 7 }], color: "#000", strokeWidth: 2, variant: "pen" },
    });
    const parsed = canvasPayloadSchema.parse({ kind: "canvas", elements: [el], viewport: { x: 0, y: 0, zoom: 1 } });
    const parsedEl = parsed.elements[0]!;
    if (parsedEl.type !== "draw") throw new Error("expected draw");
    const absolute = parsedEl.props.points.map((p) => ({ x: parsedEl.x + p.x, y: parsedEl.y + p.y }));
    expect(absolute).toEqual([{ x: 100, y: 200 }, { x: 105, y: 207 }]);
  });
});

describe("finalizeStroke", () => {
  it("discards a stroke with fewer than 2 points", () => {
    expect(finalizeStroke([{ x: 0, y: 0 }])).toBeNull();
    expect(finalizeStroke([])).toBeNull();
  });

  it("bbox x,y is the min corner, with all relativized points >= 0, for a down/right stroke", () => {
    const result = finalizeStroke([{ x: 10, y: 10 }, { x: 20, y: 30 }, { x: 15, y: 20 }]);
    expect(result).not.toBeNull();
    expect(result!.x).toBe(10);
    expect(result!.y).toBe(10);
    expect(result!.width).toBe(10);
    expect(result!.height).toBe(20);
    for (const p of result!.points) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
    }
  });

  it("bbox is correct for a stroke drawn up/left from the start point", () => {
    const result = finalizeStroke([{ x: 50, y: 50 }, { x: 10, y: 5 }, { x: 30, y: 20 }]);
    expect(result).not.toBeNull();
    expect(result!.x).toBe(10);
    expect(result!.y).toBe(5);
    expect(result!.width).toBe(40);
    expect(result!.height).toBe(45);
    // the point that was the original min corner should relativize to (0,0)
    expect(result!.points).toContainEqual(expect.objectContaining({ x: 0, y: 0 }));
  });
});

describe("recomputeParentIds", () => {
  it("drawing a frame around existing elements adopts them", () => {
    const el = draw({ id: "d1", index: "a0", x: 10, y: 10, width: 10, height: 10 }); // center (15,15)
    const f = frame({ id: "f1", index: "a1", x: 0, y: 0, width: 100, height: 100 });
    const result = recomputeParentIds([el, f]);
    expect(result.find((e) => e.id === "d1")?.parentId).toBe("f1");
  });

  it("moving a frame orphans elements now outside it and adopts newly-covered ones", () => {
    const inside = draw({ id: "d1", index: "a0", x: 10, y: 10, width: 10, height: 10 }); // center (15,15)
    const elsewhere = draw({ id: "d2", index: "a1", x: 200, y: 200, width: 10, height: 10 }); // center (205,205)
    const f = frame({ id: "f1", index: "a2", x: 0, y: 0, width: 50, height: 50 });

    const before = recomputeParentIds([inside, elsewhere, f]);
    expect(before.find((e) => e.id === "d1")?.parentId).toBe("f1");
    expect(before.find((e) => e.id === "d2")?.parentId).toBeNull();

    // move the frame to now cover "elsewhere" instead of "inside"
    const moved = before.map((e) => (e.id === "f1" ? { ...e, x: 190, y: 190 } : e));
    const after = recomputeParentIds(moved);
    expect(after.find((e) => e.id === "d1")?.parentId).toBeNull();
    expect(after.find((e) => e.id === "d2")?.parentId).toBe("f1");
  });

  it("an element under two overlapping frames goes to the topmost by index", () => {
    const el = draw({ id: "d1", index: "a0", x: 10, y: 10, width: 10, height: 10 }); // center (15,15)
    const lower = frame({ id: "f1", index: "a1", x: 0, y: 0, width: 100, height: 100 });
    const upper = frame({ id: "f2", index: "a2", x: 0, y: 0, width: 100, height: 100 }); // higher index
    const result = recomputeParentIds([el, lower, upper]);
    expect(result.find((e) => e.id === "d1")?.parentId).toBe("f2");
  });
});

describe("deleteElement", () => {
  it("removing a non-frame element removes only that element", () => {
    const a = draw({ id: "d1", index: "a0" });
    const b = draw({ id: "d2", index: "a1" });
    const result = deleteElement([a, b], "d1");
    expect(result.map((e) => e.id)).toEqual(["d2"]);
  });

  it("removing a frame nulls its former children's parentId and leaves them in place", () => {
    const f = frame({ id: "f1", index: "a0" });
    const child = draw({ id: "d1", index: "a1", parentId: "f1" });
    const result = deleteElement([f, child], "f1");
    expect(result.map((e) => e.id)).toEqual(["d1"]);
    expect(result[0]!.parentId).toBeNull();
  });
});
