export type ResizeCorner = "nw" | "ne" | "sw" | "se";

const MIN_SIZE = 24;

/**
 * Resizes a box by dragging one corner while the opposite corner stays
 * anchored in place — the standard "drag a corner handle" behavior. Works
 * for all 4 corners with one formula: the anchor is whichever corner isn't
 * being dragged, and min/max against the live pointer point gives the new
 * box regardless of which direction the drag goes.
 */
export function resizeBox(
  box: { x: number; y: number; width: number; height: number },
  corner: ResizeCorner,
  point: { x: number; y: number },
): { x: number; y: number; width: number; height: number } {
  const anchorX = corner === "nw" || corner === "sw" ? box.x + box.width : box.x;
  const anchorY = corner === "nw" || corner === "ne" ? box.y + box.height : box.y;
  const x = Math.min(anchorX, point.x);
  const y = Math.min(anchorY, point.y);
  const width = Math.max(MIN_SIZE, Math.abs(point.x - anchorX));
  const height = Math.max(MIN_SIZE, Math.abs(point.y - anchorY));
  return { x, y, width, height };
}
