/**
 * Reads each segmented glyph as a character, so a model can be handed text
 * instead of bitmaps.
 *
 * Shape matching is the $P point-cloud recognizer (Vatavu, Anthony &
 * Wobbrock, "Gestures as Point Clouds", ICMI 2012): resample the glyph's
 * strokes to N points, scale uniformly, move the centroid to the origin, and
 * greedily match the cloud against every template (templates.ts). Stroke
 * order, direction, and count don't matter to it.
 *
 * What normalizing throws away is size and position, which is all that tells
 * a minus sign from a dash-shaped part of something bigger. So before shape
 * matching, a glyph is checked against its line (the band bitmap.ts draws it
 * on): a mark much flatter than its line can only be "-" or "=", told apart
 * by stroke count; anything taller can't be either. Likewise a very narrow
 * mark can only be a "1" (or an arrow).
 */
import type { Box, Glyph, HandwritingDoc, Pt } from "./segment";
import { TEMPLATES } from "./templates";

export type Candidate = { char: string; score: number };
/** `candidates` best first; `score`s sum to 1. `confidence` is the margin between the best two (see below). */
export type Recognition = { char: string; confidence: number; candidates: Candidate[] };

/** Points per resampled cloud — $P's usual 32. */
const N = 32;
/**
 * A glyph shorter than this × its line's height is a flat mark ("-" or "=").
 * On jitter seeds 1–2, "=" reached 0.37 and the shortest other mark ("+") 0.47.
 */
const FLAT_RATIO = 0.42;
/** Flat characters, and how many strokes each is written with. */
const FLAT: Record<string, number> = { "-": 1, "=": 2 };
/**
 * A glyph narrower than this × its own height is a thin upright mark: a "1",
 * or an arrow. Leaning, a flagged "1" is shaped much like a "7" — its width
 * is what gives it away. On jitter seeds 1–2, "1" reached 0.40 and the
 * narrowest other digit or letter 0.44.
 */
const THIN_RATIO = 0.42;
const THIN = new Set(["1", "↓"]);
/**
 * Below this confidence a glyph is shown to the reader as uncertain rather
 * than as a character. Tuned on jitter seeds 1–2 only (the eval holds out the
 * clean hand and seeds 3–5): every misread there scored under 0.02, and any
 * threshold from 0.02 to 0.12 flags the same four glyphs, so this sits well
 * inside that range rather than at its edge.
 */
export const DEFAULT_MIN_CONFIDENCE = 0.1;

// ── $P ──────────────────────────────────────────────────────────────────────

type CloudPt = { x: number; y: number };

/** `n` points spaced evenly along the strokes' combined length; the pen-up jumps between strokes don't count. */
function resample(strokes: Pt[][], n: number): CloudPt[] {
  const length = strokes.reduce((sum, s) => sum + s.reduce((l, p, i) => (i ? l + Math.hypot(p.x - s[i - 1]!.x, p.y - s[i - 1]!.y) : 0), 0), 0);
  if (length === 0) return Array.from({ length: n }, () => ({ ...strokes[0]![0]! }));
  const interval = length / (n - 1);
  const out: CloudPt[] = [{ ...strokes[0]![0]! }];
  // Distance walked since the last sample; it carries over into the next stroke.
  let carried = 0;
  for (const stroke of strokes) {
    let prev = stroke[0]!;
    for (let i = 1; i < stroke.length; i++) {
      const cur = stroke[i]!;
      let d = Math.hypot(cur.x - prev.x, cur.y - prev.y);
      while (carried + d >= interval && out.length < n) {
        const t = (interval - carried) / d;
        const q = { x: prev.x + t * (cur.x - prev.x), y: prev.y + t * (cur.y - prev.y) };
        out.push(q);
        prev = q;
        d = Math.hypot(cur.x - prev.x, cur.y - prev.y);
        carried = 0;
      }
      carried += d;
      prev = cur;
    }
  }
  const last = strokes[strokes.length - 1]!;
  while (out.length < n) out.push({ ...last[last.length - 1]! });
  return out;
}

/** Scaled uniformly to a unit box (keeping its proportions), then centred on its centroid. */
function normalize(points: CloudPt[]): CloudPt[] {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1;
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  return points.map((p) => ({ x: (p.x - cx) / size, y: (p.y - cy) / size }));
}

function cloud(strokes: Pt[][]): CloudPt[] {
  return normalize(resample(strokes, N));
}

/** Greedy one-to-one matching from `a` to `b` starting at a[start]; earlier matches weigh more. Stops early once past `best`. */
function cloudDistance(a: CloudPt[], b: CloudPt[], start: number, best: number): number {
  const matched = new Array<boolean>(b.length).fill(false);
  let sum = 0;
  let i = start;
  do {
    let index = -1;
    let min = Infinity;
    for (let j = 0; j < b.length; j++) {
      if (matched[j]) continue;
      const d = Math.hypot(a[i]!.x - b[j]!.x, a[i]!.y - b[j]!.y);
      if (d < min) {
        min = d;
        index = j;
      }
    }
    matched[index] = true;
    sum += (1 - ((i - start + a.length) % a.length) / a.length) * min;
    if (sum >= best) return sum;
    i = (i + 1) % a.length;
  } while (i !== start);
  return sum;
}

function greedyCloudMatch(points: CloudPt[], template: CloudPt[]): number {
  const step = Math.floor(Math.sqrt(points.length));
  let best = Infinity;
  for (let i = 0; i < points.length; i += step) {
    best = Math.min(best, cloudDistance(points, template, i, best), cloudDistance(template, points, i, best));
  }
  return best;
}

const TEMPLATE_CLOUDS = Object.entries(TEMPLATES).map(([char, variants]) => ({
  char,
  clouds: variants.map((v) => cloud(v.map((s) => s.map(([x, y]) => ({ x, y }))))),
}));

// ── recognition ─────────────────────────────────────────────────────────────

/**
 * `band` is the glyph's line: its matrix row's box or its text line's box.
 *
 * Confidence is the relative margin between the best and second-best
 * character, (d₂ − d₁) / d₂ on $P distance: 0 when two characters fit
 * equally well, near 1 when only one fits at all. A glyph with a single
 * plausible character (a one-stroke flat mark is a minus) gets 1.
 */
export function recognizeGlyph(glyph: Glyph, band: Box): Recognition {
  const width = glyph.box.maxX - glyph.box.minX;
  const height = glyph.box.maxY - glyph.box.minY;
  const flat = height < FLAT_RATIO * (band.maxY - band.minY);
  const strokes = glyph.strokes.length;
  let plausible = TEMPLATE_CLOUDS.filter((t) => (t.char in FLAT) === flat);
  if (flat && plausible.some((t) => FLAT[t.char] === strokes)) plausible = plausible.filter((t) => FLAT[t.char] === strokes);
  if (!flat && width < THIN_RATIO * height) plausible = plausible.filter((t) => THIN.has(t.char));

  const points = cloud(glyph.strokes.map((s) => s.points));
  const ranked = plausible
    .map((t) => ({ char: t.char, distance: Math.max(1e-9, Math.min(...t.clouds.map((c) => greedyCloudMatch(points, c)))) }))
    .sort((a, b) => a.distance - b.distance || (a.char < b.char ? -1 : 1));

  // Scores: inverse squared distance, normalized — for showing the reader how the likeliest readings compare.
  const total = ranked.reduce((s, r) => s + 1 / r.distance ** 2, 0);
  const candidates = ranked.map((r) => ({ char: r.char, score: 1 / r.distance ** 2 / total }));
  const confidence = ranked.length < 2 ? 1 : (ranked[1]!.distance - ranked[0]!.distance) / ranked[1]!.distance;
  return { char: ranked[0]!.char, confidence, candidates };
}

/** Every glyph in the document, read against its own line. */
export function recognizeDoc(doc: HandwritingDoc): Map<Glyph, Recognition> {
  const out = new Map<Glyph, Recognition>();
  for (const block of doc.blocks) {
    if (block.kind === "matrix") {
      for (const row of block.rows) for (const cell of row.cells) for (const g of cell?.glyphs ?? []) out.set(g, recognizeGlyph(g, row.box));
    } else {
      for (const word of block.words) for (const g of word.glyphs) out.set(g, recognizeGlyph(g, block.box));
    }
  }
  return out;
}
