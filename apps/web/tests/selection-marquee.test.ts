/**
 * Marquee selection (lib/canvas/marquee.ts): what counts as "mostly inside"
 * the rectangle, and that a rectangle keeps meaning the same place on the
 * board at a zoom and pan other than the identity — the marquee goes screen
 * to world through d3-zoom's own invert (usePanZoom.toWorld), and the
 * selection menu comes back world to screen through toScreenRect.
 */
import { describe, expect, it } from "vitest";
import { zoomIdentity } from "d3-zoom";
import type { CanvasElement } from "@mola/shared";
import { elementBounds, elementsInRect, mostlyInside, rectFromPoints, toScreenRect, type Rect } from "../lib/canvas/marquee";

const base = { parentId: null, index: "a0", rotation: 0, opacity: 1, createdBy: "user" as const };

function textBox(id: string, x: number, y: number, width: number, height: number): CanvasElement {
  return {
    ...base, id, x, y, width, height, type: "text",
    props: { text: id, color: "#000", fontSize: 16, backgroundColor: null, bold: false, italic: false, textAlign: "left", autoFit: "grow" },
  };
}

function line(id: string, x: number, y: number, endX: number, endY: number): CanvasElement {
  return {
    ...base, id, x, y, width: Math.abs(endX), height: Math.abs(endY), type: "line",
    props: { endX, endY, color: "#000", strokeWidth: 2, dash: "solid", startArrow: false, endArrow: false },
  };
}

const RECT: Rect = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

describe("mostly inside", () => {
  it("takes a box entirely inside", () => {
    expect(mostlyInside({ minX: 10, minY: 10, maxX: 50, maxY: 50 }, RECT)).toBe(true);
  });

  it("needs more than half the box's area inside", () => {
    // 100 wide, straddling the right edge by 40, 50 and 60.
    expect(mostlyInside({ minX: 40, minY: 10, maxX: 140, maxY: 50 }, RECT)).toBe(true);
    expect(mostlyInside({ minX: 50, minY: 10, maxX: 150, maxY: 50 }, RECT)).toBe(false);
    expect(mostlyInside({ minX: 60, minY: 10, maxX: 160, maxY: 50 }, RECT)).toBe(false);
  });

  it("counts a box with no area by its center", () => {
    expect(mostlyInside({ minX: 60, minY: 20, maxX: 130, maxY: 20 }, RECT)).toBe(true);
    expect(mostlyInside({ minX: 80, minY: 20, maxX: 160, maxY: 20 }, RECT)).toBe(false);
  });

  it("selects the elements mostly inside, and leaves the rest", () => {
    const elements = [textBox("in", 10, 10, 40, 20), textBox("half-out", 70, 10, 60, 20), textBox("out", 200, 10, 40, 20)];
    expect(elementsInRect(elements, RECT)).toEqual(["in"]);
  });

  it("boxes a line drawn up and to the left from both its ends", () => {
    // Stored at its start (300, 300); its end is 200 left and 100 up.
    const el = line("l", 300, 300, -200, -100);
    expect(elementBounds(el)).toEqual({ minX: 100, minY: 200, maxX: 300, maxY: 300 });
    expect(elementsInRect([el], { minX: 90, minY: 190, maxX: 310, maxY: 310 })).toEqual(["l"]);
    expect(elementsInRect([el], { minX: 290, minY: 290, maxX: 520, maxY: 420 })).toEqual([]);
  });
});

describe("screen and world rectangles at a non-identity zoom", () => {
  // Zoomed out to half size and panned: screen = world × 0.5 + (120, -40).
  const t = zoomIdentity.translate(120, -40).scale(0.5);
  const world: Rect = { minX: 400, minY: 300, maxX: 500, maxY: 360 };

  it("puts a world rectangle where d3-zoom draws it", () => {
    const screen = toScreenRect(world, t);
    expect(screen).toEqual({ minX: 320, minY: 110, maxX: 370, maxY: 140 });
    const [minX, minY] = t.apply([world.minX, world.minY]);
    const [maxX, maxY] = t.apply([world.maxX, world.maxY]);
    expect(screen).toEqual({ minX, minY, maxX, maxY });
  });

  it("comes back to the same world rectangle through d3-zoom's invert", () => {
    const screen = toScreenRect(world, t);
    const back = rectFromPoints(
      (([x, y]) => ({ x, y }))(t.invert([screen.minX, screen.minY])),
      (([x, y]) => ({ x, y }))(t.invert([screen.maxX, screen.maxY])),
    );
    expect(back).toEqual(world);
  });

  it("selects what's under a drag on screen, wherever the view is", () => {
    const elements = [textBox("under", 400, 300, 100, 60), textBox("beside", 560, 300, 100, 60)];
    // On screen "under" is at (320, 110)–(370, 140) and "beside" at (400, 110)–(450, 140).
    const [ax, ay] = t.invert([300, 100]);
    const [bx, by] = t.invert([380, 150]);
    const marquee = rectFromPoints({ x: bx, y: by }, { x: ax, y: ay });
    expect(marquee).toEqual({ minX: 360, minY: 280, maxX: 520, maxY: 380 });
    expect(elementsInRect(elements, marquee)).toEqual(["under"]);
  });
});
