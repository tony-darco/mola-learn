/**
 * Marquee selection: in Select mode, Shift + drag on empty space draws a
 * rectangle, and on release adds what is mostly inside it to the selection.
 *
 * The rectangle is kept in world (canvas) coordinates, like the elements,
 * so it holds at any pan and zoom. toScreenRect goes the other way, for
 * what is drawn over the canvas in screen space (the selection menu).
 */
import type { CanvasElement } from "@mola/shared";

/** Axis-aligned; in world coordinates unless said otherwise. */
export type Rect = { minX: number; minY: number; maxX: number; maxY: number };

/** d3-zoom's transform: screen = world × k + (x, y), relative to the canvas svg's top-left. */
export type ViewTransform = { x: number; y: number; k: number };

export function rectFromPoints(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
}

export function unionRect(a: Rect, b: Rect): Rect {
  return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) };
}

/** A line is stored as its start plus an offset to its end, which can point up or left — so its box comes from both ends. */
export function elementBounds(el: CanvasElement): Rect {
  if (el.type === "line") return rectFromPoints({ x: el.x, y: el.y }, { x: el.x + el.props.endX, y: el.y + el.props.endY });
  return { minX: el.x, minY: el.y, maxX: el.x + el.width, maxY: el.y + el.height };
}

/** The box around all of `elements`; null for none. */
export function boundsOf(elements: CanvasElement[]): Rect | null {
  return elements.length === 0 ? null : elements.map(elementBounds).reduce(unionRect);
}

/**
 * Most of the box's area is inside the rectangle — the same rule the canvas
 * reader uses for a selected region (textSyntax/read.ts). A box with no area
 * (a straight horizontal or vertical line) counts by its center.
 */
export function mostlyInside(box: Rect, rect: Rect): boolean {
  const area = (box.maxX - box.minX) * (box.maxY - box.minY);
  if (area === 0) {
    const cx = (box.minX + box.maxX) / 2;
    const cy = (box.minY + box.maxY) / 2;
    return cx >= rect.minX && cx <= rect.maxX && cy >= rect.minY && cy <= rect.maxY;
  }
  const overlapW = Math.max(0, Math.min(box.maxX, rect.maxX) - Math.max(box.minX, rect.minX));
  const overlapH = Math.max(0, Math.min(box.maxY, rect.maxY) - Math.max(box.minY, rect.minY));
  return 2 * overlapW * overlapH > area;
}

/** Ids of the elements mostly inside the rectangle. */
export function elementsInRect(elements: CanvasElement[], rect: Rect): string[] {
  return elements.filter((el) => mostlyInside(elementBounds(el), rect)).map((el) => el.id);
}

/** A world rectangle in screen pixels, relative to the canvas svg's top-left. */
export function toScreenRect(rect: Rect, t: ViewTransform): Rect {
  return { minX: rect.minX * t.k + t.x, minY: rect.minY * t.k + t.y, maxX: rect.maxX * t.k + t.x, maxY: rect.maxY * t.k + t.y };
}
