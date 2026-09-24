import type { CanvasElement } from "@mola/shared";
import { finalizeStroke, type DraftPoint } from "./stroke";
import { nextIndexAfterAll } from "./order";

function bboxIntersectsCircle(
  el: { x: number; y: number; width: number; height: number },
  cx: number, cy: number, r: number,
): boolean {
  const nearestX = Math.max(el.x, Math.min(cx, el.x + el.width));
  const nearestY = Math.max(el.y, Math.min(cy, el.y + el.height));
  const dx = cx - nearestX, dy = cy - nearestY;
  return dx * dx + dy * dy <= r * r;
}

/** "Stroke" mode: any element whose bbox intersects the eraser circle is removed whole. */
export function eraseWholeObjects(elements: CanvasElement[], cx: number, cy: number, radius: number): CanvasElement[] {
  return elements.filter((el) => !bboxIntersectsCircle(el, cx, cy, radius));
}

/**
 * "Standard" mode: a draw stroke is split at the erased point instead of
 * deleted whole — only the ink actually under the eraser goes away, same as
 * a real pencil eraser. Every other element type has no sensible notion of
 * "partial" erase (what does erasing half a rectangle mean?), so those
 * still erase as a whole object, exactly like "Stroke" mode.
 */
export function erasePartial(
  elements: CanvasElement[], cx: number, cy: number, radius: number, makeId: () => string,
): CanvasElement[] {
  const result: CanvasElement[] = [];

  for (const el of elements) {
    if (el.type !== "draw") {
      if (!bboxIntersectsCircle(el, cx, cy, radius)) result.push(el);
      continue;
    }

    const absPoints: DraftPoint[] = el.props.points.map((p) => ({
      x: el.x + p.x, y: el.y + p.y, pressure: p.pressure,
    }));

    const runs: DraftPoint[][] = [];
    let current: DraftPoint[] = [];
    let touched = false;
    for (const p of absPoints) {
      const dx = p.x - cx, dy = p.y - cy;
      if (dx * dx + dy * dy <= radius * radius) {
        touched = true;
        if (current.length > 0) runs.push(current);
        current = [];
      } else {
        current.push(p);
      }
    }
    if (current.length > 0) runs.push(current);

    if (!touched) {
      result.push(el);
      continue;
    }

    for (const run of runs) {
      const finalized = finalizeStroke(run);
      if (!finalized) continue;
      result.push({
        ...el,
        id: makeId(),
        index: nextIndexAfterAll(result),
        x: finalized.x, y: finalized.y, width: finalized.width, height: finalized.height,
        props: { ...el.props, points: finalized.points },
      });
    }
  }

  return result;
}
