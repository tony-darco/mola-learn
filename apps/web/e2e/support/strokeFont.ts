/**
 * A tiny single-stroke "handwriting" font for driving the canvas pen tool
 * from a test. Every glyph is a hand-authored set of polylines in a unit box
 * (x across, y down), so the same text at the same position always yields
 * the identical pen path, point for point.
 *
 * `Jitter` adds human-looking variation (slant, size, position, tremor) from
 * a seeded PRNG — still fully deterministic: the same seed gives the same
 * strokes on every run.
 *
 * The only non-trivial math is sin/cos. V8 computes those with a portable
 * software implementation, and every coordinate is snapped to whole pixels
 * before it leaves this file, so a last-bit difference between machines
 * can't change the output.
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

// ── Jitter ───────────────────────────────────────────────────────────────────

/** mulberry32 — tiny, well-distributed, and the same sequence for the same seed everywhere. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Jitter = {
  rng: () => number;
  /** Per-glyph lean, ± degrees. */
  slantDeg: number;
  /** Per-glyph size change, ± fraction. */
  scale: number;
  /** Per-glyph position drift, ± px. */
  offset: number;
  /** Each stroke inside a glyph lands slightly off from the others, ± px. */
  strokeOffset: number;
  /** Smooth tremor along each stroke, px amplitude. */
  wobble: number;
};

/** Moderate, human-looking defaults — readable, but no two copies of a character alike. */
export function makeJitter(seed: number): Jitter {
  return { rng: seededRandom(seed), slantDeg: 10, scale: 0.1, offset: 2.5, strokeOffset: 1.2, wobble: 1.2 };
}

const spread = (j: Jitter, amount: number) => (j.rng() * 2 - 1) * amount;

/**
 * Slants, resizes, and nudges one glyph (or bracket/bar) as a unit, about
 * the centre of its box, then nudges each of its strokes a little on its own.
 */
export function distort(
  strokes: Pt[][], box: { x: number; y: number; w: number; h: number }, j: Jitter, slantDeg = j.slantDeg,
): Pt[][] {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const s = 1 + spread(j, j.scale);
  const k = Math.tan((spread(j, slantDeg) * Math.PI) / 180);
  const ox = spread(j, j.offset);
  const oy = spread(j, j.offset);
  return strokes.map((stroke) => {
    const sx = spread(j, j.strokeOffset);
    const sy = spread(j, j.strokeOffset);
    return stroke.map((p) => {
      const dx = (p.x - cx) * s;
      const dy = (p.y - cy) * s;
      // A positive slant leans the top of the glyph to the right.
      return { x: cx + dx - k * dy + ox + sx, y: cy + dy + oy + sy };
    });
  });
}

/** Low-frequency sine tremor along the stroke's own length, random phase per stroke. */
function wobble(points: Pt[], j: Jitter): Pt[] {
  const wavelength = 18 + j.rng() * 18;
  const phaseX = j.rng() * Math.PI * 2;
  const phaseY = j.rng() * Math.PI * 2;
  let travelled = 0;
  return points.map((p, i) => {
    const prev = points[i - 1];
    if (prev) travelled += Math.hypot(p.x - prev.x, p.y - prev.y);
    const t = (travelled / wavelength) * Math.PI * 2;
    return { x: p.x + j.wobble * Math.sin(t + phaseX), y: p.y + j.wobble * Math.sin(t * 0.8 + phaseY) };
  });
}

// ── Strokes ──────────────────────────────────────────────────────────────────

/** Largest gap between neighbouring pen samples, in px — dense enough that arcs read as curves. */
const STEP_PX = 5;

/**
 * Turns a polyline into the sample list a real pen would produce: extra
 * points inserted so no two neighbours are more than STEP_PX apart, then
 * (optionally) a hand tremor, then every point snapped to whole pixels (so
 * replay doesn't depend on sub-pixel pointer handling) with consecutive
 * repeats dropped.
 */
export function penStroke(points: Pt[], jitter?: Jitter): Stroke {
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
  for (const p of jitter ? wobble(dense, jitter) : dense) {
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

/** One drawn character: what it is, which space-separated word of the text it belongs to, and its strokes. */
export type PlacedGlyph = { char: string; word: number; strokes: Stroke[] };

/** Glyphs for `text` with its top-left corner at (x, y) and a cap height of `size`. Spaces only advance. */
export function textGlyphs(text: string, x: number, y: number, size: number, jitter?: Jitter): PlacedGlyph[] {
  const out: PlacedGlyph[] = [];
  let word = 0;
  [...text].forEach((ch, i) => {
    if (ch === " ") {
      if (text[i - 1] !== " " && i > 0) word++;
      return;
    }
    const glyph = GLYPHS[ch];
    if (!glyph) throw new Error(`strokeFont: no glyph for "${ch}"`);
    const gx = x + i * advance(size);
    const box = { x: gx, y, w: glyphWidth(size), h: size };
    const placed = glyph.map((stroke) => stroke.map(([u, v]) => ({ x: gx + u * box.w, y: y + v * size })));
    const shaped = jitter ? distort(placed, box, jitter) : placed;
    out.push({ char: ch, word, strokes: shaped.map((s) => penStroke(s, jitter)) });
  });
  return out;
}

/** Pen strokes for `text` — `textGlyphs` without the per-character bookkeeping. */
export function textStrokes(text: string, x: number, y: number, size: number, jitter?: Jitter): Stroke[] {
  return textGlyphs(text, x, y, size, jitter).flatMap((g) => g.strokes);
}

// ── Marks ────────────────────────────────────────────────────────────────────
// Pen marks drawn about writing: a loop around something, a line under it,
// an arrow between two things. People aim these at what they mean, so jitter
// moves their ends by a few px instead of scaling the whole mark.

const nudge = (p: Pt, amount: number, j?: Jitter): Pt => (j ? { x: p.x + spread(j, amount), y: p.y + spread(j, amount) } : p);

/** A loop around (cx, cy): an ellipse started at its upper left, going round a little past where it began. */
export function loopStroke(cx: number, cy: number, rx: number, ry: number, jitter?: Jitter): Stroke {
  const points = arc(cx, cy, rx, ry, 200, 580, 40).map(([x, y]) => ({ x, y }));
  const [shaped] = jitter ? distort([points], { x: cx - rx, y: cy - ry, w: 2 * rx, h: 2 * ry }, jitter, 5) : [points];
  return penStroke(shaped!, jitter);
}

/** A straight stroke from `a` to `b` — an underline, say, or a highlighter pass. */
export function straightStroke(a: Pt, b: Pt, jitter?: Jitter): Stroke {
  return penStroke([nudge(a, 2.5, jitter), nudge(b, 2.5, jitter)], jitter);
}

/**
 * An arrow from `tail` to `tip`: the shaft, then a head of two barbs about
 * 28° either side of it — drawn as a separate V stroke, or on in the same
 * stroke (out along one barb, back to the tip, out along the other).
 */
export function arrowStrokes(tail: Pt, tip: Pt, head: "separate" | "joined", jitter?: Jitter, barbLength = 18): Stroke[] {
  const t = nudge(tip, 2.5, jitter);
  const s = nudge(tail, 2.5, jitter);
  const back = Math.atan2(s.y - t.y, s.x - t.x);
  const barb = (side: 1 | -1): Pt => {
    const a = back + (side * (28 + (jitter ? spread(jitter, 6) : 0)) * Math.PI) / 180;
    const l = barbLength * (1 + (jitter ? spread(jitter, 0.15) : 0));
    return { x: t.x + l * Math.cos(a), y: t.y + l * Math.sin(a) };
  };
  const [left, right] = [barb(1), barb(-1)];
  if (head === "joined") return [penStroke([s, t, left, t, right], jitter)];
  return [penStroke([s, t], jitter), penStroke([left, nudge(t, jitter?.strokeOffset ?? 0, jitter), right], jitter)];
}
