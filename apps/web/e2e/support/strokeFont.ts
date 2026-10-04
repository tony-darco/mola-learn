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
  ...LETTERS(),
};

/**
 * The rest of the alphabet: letters, Greek, and the symbols a whiteboard
 * uses. Capitals and digits fill the box (y 0 cap line, 1 baseline);
 * lowercase letters sit between the x-height (y 0.45) and the baseline, with
 * ascenders up to 0 and descenders down to 1.35. Printed, one or a few
 * strokes each, the way people write on a board.
 */
function LETTERS(): Record<string, XY[][]> {
  const bowl = (cx: number, cy: number, rx: number, ry: number) => arc(cx, cy, rx, ry, -40, -360, 14);
  // A tap of the pen, barely moving. `half`: half its width, as a share of the glyph's — a pixel or two at the usual sizes.
  const dot = (x: number, y: number, half = 0.12): XY[] => [[x - half, y], [x + half, y + 0.03]];
  return {
    A: [[[0, 1], [0.5, 0], [1, 1]], [[0.22, 0.62], [0.78, 0.62]]],
    B: [[[0.1, 0], [0.1, 1]], [[0.1, 0], [0.55, 0], ...arc(0.55, 0.24, 0.32, 0.24, 270, 450, 8), [0.15, 0.48], [0.6, 0.48], ...arc(0.6, 0.74, 0.36, 0.26, 270, 450, 8), [0.1, 1]]],
    C: [arc(0.58, 0.5, 0.52, 0.5, -45, -315, 16)],
    D: [[[0.1, 0], [0.1, 1]], [[0.1, 0], [0.4, 0], ...arc(0.4, 0.5, 0.55, 0.5, -90, 90, 12), [0.1, 1]]],
    E: [[[0.9, 0], [0.1, 0], [0.1, 1], [0.9, 1]], [[0.1, 0.5], [0.7, 0.5]]],
    F: [[[0.9, 0], [0.1, 0], [0.1, 1]], [[0.1, 0.48], [0.7, 0.48]]],
    G: [[...arc(0.55, 0.5, 0.47, 0.5, -40, -360, 16), [0.55, 0.55]]],
    H: [[[0.1, 0], [0.1, 1]], [[0.9, 0], [0.9, 1]], [[0.1, 0.5], [0.9, 0.5]]],
    I: [[[0.5, 0], [0.5, 1]], [[0.2, 0], [0.8, 0]], [[0.2, 1], [0.8, 1]]],
    J: [[[0.2, 0], [0.95, 0]], [[0.7, 0], [0.7, 0.72], ...arc(0.42, 0.72, 0.28, 0.28, 0, 170, 8)]],
    K: [[[0.1, 0], [0.1, 1]], [[0.88, 0], [0.1, 0.6]], [[0.35, 0.42], [0.92, 1]]],
    L: [[[0.1, 0], [0.1, 1], [0.88, 1]]],
    M: [[[0.05, 1], [0.1, 0], [0.5, 0.65], [0.9, 0], [0.95, 1]]],
    N: [[[0.1, 1], [0.1, 0], [0.9, 1], [0.9, 0]]],
    O: [arc(0.5, 0.5, 0.5, 0.5, -90, 270, 20)],
    P: [[[0.1, 1], [0.1, 0], [0.55, 0], ...arc(0.55, 0.25, 0.35, 0.25, 270, 450, 8), [0.1, 0.5]]],
    Q: [arc(0.5, 0.5, 0.5, 0.5, -90, 270, 20), [[0.58, 0.68], [1, 1.1]]],
    S: [[...arc(0.5, 0.25, 0.4, 0.25, -30, -270, 8), ...arc(0.5, 0.75, 0.42, 0.25, -90, 150, 10)]],
    T: [[[0.02, 0], [0.98, 0]], [[0.5, 0], [0.5, 1]]],
    U: [[[0.1, 0], [0.1, 0.65], ...arc(0.5, 0.65, 0.4, 0.35, 180, 0, 10), [0.9, 0]]],
    V: [[[0.02, 0], [0.5, 1], [0.98, 0]]],
    W: [[[0, 0], [0.25, 1], [0.5, 0.35], [0.75, 1], [1, 0]]],
    X: [[[0.1, 0], [0.9, 1]], [[0.9, 0], [0.1, 1]]],
    Y: [[[0.05, 0], [0.5, 0.5]], [[0.95, 0], [0.5, 0.5], [0.5, 1]]],
    Z: [[[0.1, 0], [0.9, 0], [0.1, 1], [0.9, 1]]],
    a: [[...bowl(0.47, 0.73, 0.33, 0.27), [0.8, 0.45], [0.82, 1]]],
    b: [[[0.12, 0], [0.12, 1]], arc(0.47, 0.73, 0.35, 0.27, 180, 540, 16)],
    c: [arc(0.55, 0.73, 0.42, 0.27, -40, -320, 12)],
    d: [[...bowl(0.47, 0.73, 0.33, 0.27), [0.8, 0], [0.82, 1]]],
    e: [[[0.12, 0.72], [0.88, 0.72], ...arc(0.5, 0.73, 0.38, 0.27, 0, -315, 14)]],
    f: [[[0.85, 0.08], [0.65, 0], [0.4, 0.05], [0.3, 0.25], [0.3, 1]], [[0.05, 0.45], [0.7, 0.45]]],
    g: [[...bowl(0.47, 0.68, 0.33, 0.23), [0.8, 0.45], [0.8, 1.15], ...arc(0.5, 1.15, 0.3, 0.2, 0, 160, 6)]],
    h: [[[0.12, 0], [0.12, 1]], [[0.13, 0.65], [0.3, 0.48], [0.6, 0.45], [0.8, 0.55], [0.82, 1]]],
    i: [[[0.5, 0.45], [0.5, 1]], dot(0.5, 0.22)],
    j: [[[0.6, 0.45], [0.6, 1.15], ...arc(0.35, 1.15, 0.25, 0.2, 0, 160, 6)], dot(0.6, 0.22)],
    k: [[[0.12, 0], [0.12, 1]], [[0.8, 0.45], [0.12, 0.78], [0.85, 1]]],
    // A small tail, as people write it to tell it from a 1.
    l: [[[0.3, 0], [0.3, 0.8], [0.45, 0.97], [0.75, 1], [0.9, 0.92]]],
    m: [[[0.06, 1], [0.06, 0.45], [0.06, 0.6], [0.2, 0.47], [0.35, 0.46], [0.5, 0.56], [0.5, 1], [0.5, 0.6], [0.65, 0.47], [0.8, 0.46], [0.94, 0.56], [0.94, 1]]],
    n: [[[0.1, 0.45], [0.1, 1], [0.1, 0.62], [0.3, 0.47], [0.6, 0.45], [0.85, 0.55], [0.88, 1]]],
    o: [arc(0.5, 0.73, 0.45, 0.27, -90, 270, 16)],
    p: [[[0.12, 0.45], [0.12, 1.35]], [[0.12, 0.55], [0.35, 0.45], [0.65, 0.46], [0.85, 0.62], [0.82, 0.85], [0.6, 0.98], [0.3, 0.97], [0.12, 0.88]]],
    q: [[...bowl(0.47, 0.72, 0.33, 0.26), [0.8, 0.45], [0.8, 1.35], [0.95, 1.25]]],
    r: [[[0.15, 0.45], [0.15, 1]], [[0.15, 0.65], [0.35, 0.5], [0.6, 0.45], [0.85, 0.5]]],
    s: [[[0.85, 0.52], [0.55, 0.45], [0.2, 0.5], [0.2, 0.65], [0.5, 0.72], [0.82, 0.8], [0.82, 0.95], [0.5, 1], [0.15, 0.95]]],
    t: [[[0.45, 0.1], [0.45, 0.9], [0.6, 1], [0.85, 0.95]], [[0.1, 0.45], [0.85, 0.45]]],
    u: [[[0.1, 0.45], [0.1, 0.85], [0.3, 1], [0.6, 1], [0.85, 0.85], [0.87, 0.45], [0.87, 1]]],
    v: [[[0.05, 0.45], [0.5, 1], [0.95, 0.45]]],
    w: [[[0, 0.45], [0.25, 1], [0.5, 0.6], [0.75, 1], [1, 0.45]]],
    x: [[[0.1, 0.45], [0.9, 1]], [[0.9, 0.45], [0.1, 1]]],
    y: [[[0.1, 0.45], [0.5, 0.95]], [[0.9, 0.45], [0.3, 1.35]]],
    z: [[[0.1, 0.45], [0.9, 0.45], [0.1, 1], [0.9, 1]]],
    "×": [[[0.15, 0.3], [0.85, 0.8]], [[0.85, 0.3], [0.15, 0.8]]],
    "÷": [[[0.1, 0.55], [0.9, 0.55]], dot(0.5, 0.3, 0.06), dot(0.5, 0.78, 0.06)],
    "/": [[[0.85, 0], [0.15, 1]]],
    "(": [[[0.85, -0.05], [0.45, 0.2], [0.25, 0.52], [0.45, 0.85], [0.85, 1.1]]],
    ")": [[[0.15, -0.05], [0.55, 0.2], [0.75, 0.52], [0.55, 0.85], [0.15, 1.1]]],
    ".": [dot(0.5, 0.95)],
    ",": [[[0.6, 0.85], [0.65, 0.98], [0.5, 1.12], [0.25, 1.22]]],
    "→": [[[0, 0.55], [1, 0.55]], [[0.75, 0.38], [1, 0.55], [0.75, 0.72]]],
    "←": [[[1, 0.55], [0, 0.55]], [[0.25, 0.38], [0, 0.55], [0.25, 0.72]]],
    "↑": [[[0.5, 1], [0.5, 0]], [[0.15, 0.35], [0.5, 0], [0.85, 0.35]]],
    θ: [arc(0.5, 0.5, 0.42, 0.5, -90, 270, 18), [[0.12, 0.5], [0.88, 0.5]]],
    "°": [arc(0.5, 0.15, 0.4, 0.15, -90, 270, 10)],
    "^": [[[0.1, 0.4], [0.5, 0.05], [0.9, 0.4]]],
    "*": [[[0.5, 0.1], [0.5, 0.6]], [[0.12, 0.22], [0.88, 0.48]], [[0.88, 0.22], [0.12, 0.48]]],
    Ω: [[[0.05, 1], [0.3, 1], ...arc(0.5, 0.45, 0.42, 0.45, 125, 415, 16), [0.7, 1], [0.95, 1]]],
    Δ: [[[0.5, 0], [0.03, 1], [0.97, 1], [0.5, 0]]],
    π: [[[0.05, 0.5], [0.95, 0.45]], [[0.3, 0.48], [0.28, 1]], [[0.7, 0.47], [0.75, 0.92], [0.88, 1]]],
  };
}

/** Width of a glyph's box, as a multiple of `glyphWidth` — only for glyphs that aren't the usual width. */
const GLYPH_WIDTHS: Record<string, number> = {
  I: 0.8, M: 1.2, O: 1.45, Q: 1.45, W: 1.3, i: 0.5, j: 0.6, l: 0.6, m: 1.3, o: 0.9, r: 0.75, t: 0.75, w: 1.2,
  "/": 0.8, "(": 0.5, ")": 0.5, ".": 0.4, ",": 0.5, "→": 1.5, "←": 1.5, θ: 0.9, "°": 0.7, "^": 0.8, "*": 0.8,
  Ω: 1.1, Δ: 1.1, π: 1.0,
};

/** Every character the font can write. */
export const FONT_CHARS = Object.keys(GLYPHS);

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
  // A dot small enough to round to one pixel is still a pen-down, pen-move, pen-up.
  if (out.length === 1) out.push({ x: out[0]!.x + 1, y: out[0]!.y });
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

// ── Scripted text ────────────────────────────────────────────────────────────

/** Subscripts and superscripts are this × the line's size… */
const SCRIPT_SIZE = 0.62;
/** …a subscript's baseline drops this × the size below the line's, a superscript's rises this far above it. */
const SUB_DROP = 0.22;
const SUP_RISE = 0.45;

/** One character to write, and whether it is a subscript or a superscript. */
export type ScriptedChar = { char: string; script: "sub" | "sup" | null };
export type ScriptedGlyph = PlacedGlyph & { script: "sub" | "sup" | null };

/**
 * `text` as characters: "_" makes the next character a subscript and "^" a
 * superscript, or every character of a braced group after it ("x^{10}").
 * A backslash writes the next character as itself ("\^" is a caret).
 */
export function parseScripted(text: string): ScriptedChar[] {
  const out: ScriptedChar[] = [];
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    let ch = chars[i]!;
    if (ch === "\\") {
      out.push({ char: chars[++i]!, script: null });
      continue;
    }
    if (ch !== "_" && ch !== "^") {
      out.push({ char: ch, script: null });
      continue;
    }
    const script = ch === "_" ? "sub" : "sup";
    ch = chars[++i]!;
    if (ch !== "{") {
      out.push({ char: ch, script });
      continue;
    }
    while (chars[++i] !== "}") out.push({ char: chars[i]!, script });
  }
  return out;
}

/** Width of one character's box at `size`. */
export const charWidth = (ch: string, size: number) => glyphWidth(size) * (GLYPH_WIDTHS[ch] ?? 1);

/**
 * Handwriting the way people space it: each character starts a small gap
 * after the ink of the one before (a "1" or an "l" takes little room), a
 * space leaves a wider one. Subscripts and superscripts (see parseScripted)
 * are smaller and dropped or raised. The top-left of the line's cap height
 * is at (x, y).
 */
export function writeText(text: string, x: number, y: number, size: number, jitter?: Jitter): { glyphs: ScriptedGlyph[]; width: number } {
  const glyphs: ScriptedGlyph[] = [];
  let cx = x;
  let word = 0;
  let spaced = false;
  for (const { char, script } of parseScripted(text)) {
    if (char === " ") {
      cx += 0.6 * size;
      spaced = glyphs.length > 0;
      continue;
    }
    if (spaced) word++;
    spaced = false;
    const glyph = GLYPHS[char];
    if (!glyph) throw new Error(`strokeFont: no glyph for "${char}"`);
    const s = script ? SCRIPT_SIZE * size : size;
    // The script's cap line: its baseline, less its height.
    const top = script === "sub" ? y + size + SUB_DROP * size - s : script === "sup" ? y + size - SUP_RISE * size - s : y;
    const w = charWidth(char, s);
    const inkLeft = Math.min(...glyph.flat().map(([u]) => u));
    const inkRight = Math.max(...glyph.flat().map(([u]) => u));
    const left = cx - inkLeft * w;
    const box = { x: left, y: top, w, h: s };
    const placed = glyph.map((stroke) => stroke.map(([u, v]) => ({ x: left + u * w, y: top + v * s })));
    const shaped = jitter ? distort(placed, box, jitter) : placed;
    glyphs.push({ char, word, script, strokes: shaped.map((st) => penStroke(st, jitter)) });
    cx = left + inkRight * w + 0.35 * size;
  }
  return { glyphs, width: cx - x };
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
