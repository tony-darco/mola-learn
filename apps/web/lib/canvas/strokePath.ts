import { getStroke } from "perfect-freehand";
import type { CanvasDrawElement } from "@mola/shared";

/**
 * getStroke returns an outline polygon (point array), not a path string —
 * getSvgPathFromStroke is the standard community conversion (from
 * perfect-freehand's own docs) using quadratic-bezier midpoints so the
 * outline reads as a smooth filled shape rather than a faceted polygon.
 */
export function strokeToSvgPath(props: CanvasDrawElement["props"]): string {
  const hasPressure = props.points.some((p) => p.pressure !== undefined);
  const isHighlighter = props.variant === "highlighter";
  const outline = getStroke(props.points, {
    // A highlighter is a flat, uniform-width marker, not a tapered pen —
    // thinning:0 (no pressure-driven width change) and simulatePressure
    // off keeps every point the same width regardless of input device.
    size: props.strokeWidth * (isHighlighter ? 3 : 2),
    thinning: isHighlighter ? 0 : 0.6,
    smoothing: 0.5,
    streamline: 0.5,
    simulatePressure: !isHighlighter && !hasPressure,
  });
  return getSvgPathFromStroke(outline);
}

function getSvgPathFromStroke(stroke: number[][]): string {
  if (stroke.length === 0) return "";
  const first = stroke[0]!;
  const d = stroke.reduce<(string | number)[]>(
    (acc, [x0, y0], i, arr) => {
      const next = arr[(i + 1) % arr.length]!;
      acc.push(x0!, y0!, (x0! + next[0]!) / 2, (y0! + next[1]!) / 2);
      return acc;
    },
    ["M", first[0]!, first[1]!, "Q"],
  );
  d.push("Z");
  return d.join(" ");
}
