/**
 * A tiny single-stroke "handwriting" font for driving the canvas pen tool
 * from a test. Every glyph is a hand-authored set of polylines in a unit box
 * (x across, y down) — no randomness, no wobble — so the same text at the
 * same position always yields the identical pen path, point for point.
 *
 * The only non-trivial math is `arc`'s sin/cos. V8 computes those with a
 * portable software implementation, and every coordinate is snapped to whole
 * pixels in `penStroke` before it leaves this file, so a last-bit difference
 * between machines can't change the output.
 */
export type Pt = { x: number; y: number };
export type Stroke = Pt[];
type XY = [number, number];

/** Points along an elliptical arc. Angles are degrees, y-down, so a larger angle sweeps clockwise on screen. */
function arc(cx: number, cy: number, rx: number, ry: number, fromDeg: number, toDeg: number, n: number): XY[] {
  const out: XY[] = [];
  for (let i = 0; i <= n; i++) {
    const a = ((fromDeg + ((toDeg - fromDeg) * i) / n) * Math.PI) / 180;
    out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return out;
}

/** Each glyph is a list of strokes; each stroke is one pen-down…pen-up polyline. */
const GLYPHS: Record<string, XY[][]> = {
  "0": [arc(0.5, 0.5, 0.42, 0.5, -90, 270, 20)],
  "1": [[[0.2, 0.22], [0.55, 0], [0.55, 1]]],
  "2": [[...arc(0.5, 0.27, 0.42, 0.27, 190, 400, 12), [0.05, 1], [0.95, 1]]],
  "3": [[...arc(0.5, 0.25, 0.4, 0.25, 200, 450, 10), ...arc(0.5, 0.75, 0.45, 0.25, 270, 520, 12)]],
  "4": [[[0.7, 1], [0.7, 0], [0.05, 0.7], [0.95, 0.7]]],
  "5": [[[0.9, 0], [0.15, 0], [0.12, 0.45], ...arc(0.48, 0.7, 0.45, 0.3, 235, 500, 12)]],
  "6": [[[0.8, 0.02], [0.45, 0.1], [0.15, 0.4], [0.07, 0.68], ...arc(0.5, 0.68, 0.43, 0.32, 180, 540, 18)]],
  "7": [[[0.05, 0], [0.95, 0], [0.4, 1]]],
  "8": [arc(0.5, 0.26, 0.34, 0.26, 90, 450, 16), arc(0.5, 0.76, 0.42, 0.24, 270, 630, 18)],
  "9": [[...arc(0.5, 0.32, 0.42, 0.32, 0, 360, 18), [0.9, 0.6], [0.6, 0.9], [0.2, 1]]],
  "-": [[[0.1, 0.5], [0.9, 0.5]]],
  "+": [[[0.1, 0.5], [0.9, 0.5]], [[0.5, 0.15], [0.5, 0.85]]],
  "=": [[[0.1, 0.35], [0.9, 0.35]], [[0.1, 0.65], [0.9, 0.65]]],
  R: [
    [[0.1, 1], [0.1, 0], [0.6, 0], ...arc(0.6, 0.25, 0.3, 0.25, 270, 450, 8), [0.1, 0.5]],
    [[0.45, 0.5], [0.9, 1]],
  ],
  "↓": [[[0.5, 0], [0.5, 1]], [[0.15, 0.62], [0.5, 1], [0.85, 0.62]]],
};

/** Largest gap between neighbouring pen samples, in px — dense enough that arcs read as curves. */
const STEP_PX = 5;

/**
 * Turns a polyline into the sample list a real pen would produce: extra
 * points inserted so no two neighbours are more than STEP_PX apart, then
 * every point snapped to whole pixels (so replay doesn't depend on
 * sub-pixel pointer handling) with consecutive repeats dropped.
 */
export function penStroke(points: Pt[]): Stroke {
  const dense: Pt[] = [];
  points.forEach((p, i) => {
    const prev = points[i - 1];
    if (prev) {
      const n = Math.ceil(Math.hypot(p.x - prev.x, p.y - prev.y) / STEP_PX);
      for (let k = 1; k < n; k++) {
        dense.push({ x: prev.x + ((p.x - prev.x) * k) / n, y: prev.y + ((p.y - prev.y) * k) / n });
      }
    }
    dense.push(p);
  });

  const out: Stroke = [];
  for (const p of dense) {
    const q = { x: Math.round(p.x), y: Math.round(p.y) };
    const last = out[out.length - 1];
    if (!last || last.x !== q.x || last.y !== q.y) out.push(q);
  }
  return out;
}

/** Glyph box width for a given cap height. */
export const glyphWidth = (size: number): number => size * 0.6;
/** Distance from one glyph's left edge to the next. */
export const advance = (size: number): number => size * 0.9;

export function textWidth(text: string, size: number): number {
  return text.length === 0 ? 0 : (text.length - 1) * advance(size) + glyphWidth(size);
}

/** Pen strokes for `text` with its top-left corner at (x, y) and a cap height of `size`. Spaces only advance. */
export function textStrokes(text: string, x: number, y: number, size: number): Stroke[] {
  const out: Stroke[] = [];
  [...text].forEach((ch, i) => {
    if (ch === " ") return;
    const glyph = GLYPHS[ch];
    if (!glyph) throw new Error(`strokeFont: no glyph for "${ch}"`);
    const gx = x + i * advance(size);
    for (const stroke of glyph) {
      out.push(penStroke(stroke.map(([u, v]) => ({ x: gx + u * glyphWidth(size), y: y + v * size }))));
    }
  });
  return out;
}
