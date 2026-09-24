import { describe, expect, it } from "vitest";
import type { CanvasElement } from "@mola/shared";
import { eraseWholeObjects, erasePartial } from "../lib/canvas/eraser";

function draw(id: string, absPoints: { x: number; y: number }[]): CanvasElement {
  const xs = absPoints.map((p) => p.x), ys = absPoints.map((p) => p.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  return {
    id, index: "a0", parentId: null, rotation: 0, opacity: 1, createdBy: "user",
    x: minX, y: minY,
    width: Math.max(...xs) - minX, height: Math.max(...ys) - minY,
    type: "draw",
    props: {
      points: absPoints.map((p) => ({ x: p.x - minX, y: p.y - minY })),
      color: "#000", strokeWidth: 2, variant: "pen",
    },
  };
}

function shape(id: string, x: number, y: number, width: number, height: number): CanvasElement {
  return {
    id, index: "a0", parentId: null, rotation: 0, opacity: 1, createdBy: "user",
    x, y, width, height, type: "shape",
    props: { shapeKind: "rectangle", color: "#000", fillColor: null, fillStyle: "none", strokeWidth: 2, dash: "solid" },
  };
}

let counter = 0;
const makeId = () => `gen-${counter++}`;

describe("eraseWholeObjects (Stroke mode)", () => {
  it("removes an element whose bbox intersects the eraser circle", () => {
    const el = shape("s1", 0, 0, 10, 10);
    const result = eraseWholeObjects([el], 5, 5, 3);
    expect(result).toEqual([]);
  });

  it("leaves an element outside the eraser circle untouched", () => {
    const el = shape("s1", 0, 0, 10, 10);
    const result = eraseWholeObjects([el], 100, 100, 3);
    expect(result).toEqual([el]);
  });
});

describe("erasePartial (Standard mode)", () => {
  it("leaves a stroke untouched if the eraser never crosses it", () => {
    const el = draw("d1", [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }]);
    const result = erasePartial([el], 500, 500, 3, makeId);
    expect(result).toEqual([el]);
  });

  it("splits a stroke into two pieces when erased in the middle", () => {
    const el = draw("d1", [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 }, { x: 40, y: 0 }]);
    // erase around x=20 — the middle point falls inside the eraser radius
    const result = erasePartial([el], 20, 0, 5, makeId);
    expect(result).toHaveLength(2);
    for (const piece of result) {
      if (piece.type !== "draw") throw new Error("expected draw");
      expect(piece.props.points.length).toBeGreaterThanOrEqual(2);
    }
    // original element is gone, replaced by fresh ids
    expect(result.every((r) => r.id !== "d1")).toBe(true);
  });

  it("deletes the whole stroke if every point falls within the eraser radius", () => {
    const el = draw("d1", [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]);
    const result = erasePartial([el], 1, 0, 50, makeId);
    expect(result).toEqual([]);
  });

  it("drops a run left with fewer than 2 points (a stray remnant)", () => {
    // erasing the middle leaves a single point on the left and a single point on the right
    const el = draw("d1", [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }]);
    const result = erasePartial([el], 10, 0, 3, makeId);
    // the two remaining single-point runs are each discarded by finalizeStroke
    expect(result).toEqual([]);
  });

  it("non-draw elements still erase as a whole object under Standard mode", () => {
    const el = shape("s1", 0, 0, 10, 10);
    const result = erasePartial([el], 5, 5, 3, makeId);
    expect(result).toEqual([]);
  });
});
