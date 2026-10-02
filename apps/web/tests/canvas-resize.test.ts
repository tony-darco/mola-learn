import { describe, expect, it } from "vitest";
import { resizeBox } from "../lib/canvas/resize";

const box = { x: 100, y: 100, width: 50, height: 50 };

describe("resizeBox", () => {
  it("dragging se keeps the nw corner (x,y) anchored", () => {
    const r = resizeBox(box, "se", { x: 180, y: 160 });
    expect(r).toEqual({ x: 100, y: 100, width: 80, height: 60 });
  });

  it("dragging nw keeps the se corner anchored", () => {
    const r = resizeBox(box, "nw", { x: 80, y: 90 });
    expect(r).toEqual({ x: 80, y: 90, width: 70, height: 60 });
  });

  it("dragging ne keeps the sw corner anchored", () => {
    const r = resizeBox(box, "ne", { x: 170, y: 120 });
    expect(r).toEqual({ x: 100, y: 120, width: 70, height: 30 });
  });

  it("dragging sw keeps the ne corner anchored", () => {
    const r = resizeBox(box, "sw", { x: 90, y: 170 });
    expect(r).toEqual({ x: 90, y: 100, width: 60, height: 70 });
  });

  it("dragging past the anchor flips the box instead of going negative", () => {
    const r = resizeBox(box, "se", { x: 90, y: 90 });
    expect(r.x).toBeLessThanOrEqual(100);
    expect(r.y).toBeLessThanOrEqual(100);
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
  });

  it("clamps to a minimum size instead of collapsing to zero", () => {
    const r = resizeBox(box, "se", { x: 101, y: 101 });
    expect(r.width).toBeGreaterThanOrEqual(24);
    expect(r.height).toBeGreaterThanOrEqual(24);
  });
});
