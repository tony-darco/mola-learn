/**
 * Reads each segmented glyph as a character, so a model can be handed text
 * instead of bitmaps. What it isn't sure of, it says so (a low confidence)
 * rather than guess: a flagged glyph is cheap for the reader to resolve from
 * context, a confidently wrong one is not.
 *
 * Shape matching is the $P point-cloud recognizer (Vatavu, Anthony &
 * Wobbrock, "Gestures as Point Clouds", ICMI 2012): resample the glyph's
 * strokes to N points, scale uniformly, move the centroid to the origin, and
 * greedily match the cloud against every template (templates.ts). Stroke
 * order, direction, and count don't matter to it.
 *
 * Two things the point cloud smears out are added back:
 *
 * - Where the strokes end. Both ends of a "3" are on its left; a "2" ends at
 *   the bottom right, after its flat base; a "5" starts at the top right.
 *   Each template's distance also counts how far the glyph's stroke ends are
 *   from the template's (a chamfer distance between the two sets of ends).
 *
 * - Straight strokes. "-", "=" and "+" are made of nothing else, so they are
 *   identified from their strokes directly, whatever their size: one
 *   near-horizontal stroke is a minus, two that don't cross an equals sign,
 *   a near-horizontal and a near-vertical one crossing near their middles a
 *   plus. Nothing else can be a minus or an equals sign.
 *
 * Every constant here was tuned on jitter seeds 1–20 of the eval fixture
 * (evals/canvas-syntax), and checked once on seeds 100–149 afterwards.
 */
import type { Glyph, HandwritingDoc, Pt } from "./segment";
import { TEMPLATES } from "./templates";

export type Candidate = { char: string; score: number };
/** `candidates` best first; `score`s sum to 1. `confidence` is the margin between the best two (see below). */
export type Recognition = { char: string; confidence: number; candidates: Candidate[] };

/** Points per resampled cloud — $P's usual 32. */
const N = 32;
/**
 * How much a unit of stroke-end distance counts against a unit of $P
 * distance. Accuracy on seeds 1–20 is flat from 4 to 10; this is the middle.
 */
const ENDPOINT_WEIGHT = 6;
/** A stroke is straight when no point strays from the line between its ends by more than this × that line's length. */
const STRAIGHT = 0.25;
/** A straight stroke is near-horizontal (or near-vertical) when it rises (or leans) less than this per unit of run (about 31°). */
const NEAR_AXIS = 0.6;
/** Where two strokes of a "+" cross, as a fraction along each: near the middle, not at an end (that's a "⊥" or an "L"). */
const MIDDLE = [0.15, 0.85] as const;
/**
 * Below this confidence a glyph is shown to the reader as uncertain rather
 * than as a character. On seeds 1–20 the one misread left (a leaning "1" whose
 * flag had flattened into a "7"'s top bar) scored 0.16, and 26 of 3,481
 * correct reads scored under 0.25 — so this flags under 1% of glyphs, with
 * room above every misread seen.
 */
export const DEFAULT_MIN_CONFIDENCE = 0.25;

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

/**
 * The glyph as a $P cloud — scaled uniformly to a unit box (keeping its
 * proportions) and centred on its centroid — plus its stroke ends in the
 * same frame.
 */
function shape(strokes: Pt[][]): { cloud: CloudPt[]; ends: CloudPt[] } {
  const points = resample(strokes, N);
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1;
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  const place = (p: Pt) => ({ x: (p.x - cx) / size, y: (p.y - cy) / size });
  return { cloud: points.map(place), ends: strokes.flatMap((s) => [place(s[0]!), place(s[s.length - 1]!)]) };
}

/** Greedy one-to-one matching from `a` to `b` starting at a[start]; earlier matches weigh more. Stops early once past `best`. */
function cloudDistance(a: CloudPt[], b: CloudPt[], start: number, best: number): number {
  const matched = new Array<boolean>(b.length).fill(false);
  let sum = 0;
  let i = start;
  do {
    let index = -1;
    let min = Infinity; // squared — the square root is taken once, for the winner
    for (let j = 0; j < b.length; j++) {
      if (matched[j]) continue;
      const dx = a[i]!.x - b[j]!.x;
      const dy = a[i]!.y - b[j]!.y;
      const d = dx * dx + dy * dy;
      if (d < min) {
        min = d;
        index = j;
      }
    }
    matched[index] = true;
    sum += (1 - ((i - start + a.length) % a.length) / a.length) * Math.sqrt(min);
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

/** Mean distance from each point of either set to the nearest point of the other. Order and count don't matter. */
function chamfer(a: CloudPt[], b: CloudPt[]): number {
  const oneWay = (from: CloudPt[], to: CloudPt[]) =>
    from.reduce((s, p) => s + Math.min(...to.map((q) => Math.hypot(p.x - q.x, p.y - q.y))), 0) / from.length;
  return (oneWay(a, b) + oneWay(b, a)) / 2;
}

const TEMPLATE_SHAPES = Object.entries(TEMPLATES).map(([char, variants]) => ({
  char,
  shapes: variants.map((v) => shape(v.map((s) => s.map(([x, y]) => ({ x, y }))))),
}));

// ── straight strokes ────────────────────────────────────────────────────────

type Chord = { a: Pt; b: Pt };

function straightChord(points: Pt[]): Chord | null {
  const a = points[0]!;
  const b = points[points.length - 1]!;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length === 0) return null;
  const stray = Math.max(...points.map((p) => Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / length));
  return stray <= STRAIGHT * length ? { a, b } : null;
}

const horizontal = (c: Chord) => Math.abs(c.b.y - c.a.y) <= NEAR_AXIS * Math.abs(c.b.x - c.a.x);
const vertical = (c: Chord) => Math.abs(c.b.x - c.a.x) <= NEAR_AXIS * Math.abs(c.b.y - c.a.y);

/** Where two chords cross, as a fraction along each; null if they don't. */
function crossing(p: Chord, q: Chord): [number, number] | null {
  const r = { x: p.b.x - p.a.x, y: p.b.y - p.a.y };
  const s = { x: q.b.x - q.a.x, y: q.b.y - q.a.y };
  const denom = r.x * s.y - r.y * s.x;
  if (denom === 0) return null;
  const t = ((q.a.x - p.a.x) * s.y - (q.a.y - p.a.y) * s.x) / denom;
  const u = ((q.a.x - p.a.x) * r.y - (q.a.y - p.a.y) * r.x) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [t, u] : null;
}

/** "-", "=" or "+" if the glyph is exactly one of them, drawn in straight strokes; otherwise null. */
function straightStrokeChar(glyph: Glyph): string | null {
  const chords = glyph.strokes.map((s) => straightChord(s.points));
  if (chords.some((c) => c === null)) return null;
  const [p, q] = chords as Chord[];
  if (chords.length === 1) return horizontal(p!) ? "-" : null;
  if (chords.length !== 2) return null;
  const cross = crossing(p!, q!);
  if (horizontal(p!) && horizontal(q!)) return cross ? null : "=";
  const middle = (t: number) => t >= MIDDLE[0] && t <= MIDDLE[1];
  if (cross && middle(cross[0]) && middle(cross[1]) && ((horizontal(p!) && vertical(q!)) || (vertical(p!) && horizontal(q!)))) return "+";
  return null;
}

// ── recognition ─────────────────────────────────────────────────────────────

/**
 * Confidence is the relative margin between the best and second-best
 * character, (d₂ − d₁) / d₂: 0 when two characters fit equally well, near 1
 * when only one fits at all. A glyph identified by its straight strokes
 * gets 1.
 */
export function recognizeGlyph(glyph: Glyph): Recognition {
  const straight = straightStrokeChar(glyph);
  if (straight) return { char: straight, confidence: 1, candidates: [{ char: straight, score: 1 }] };

  const g = shape(glyph.strokes.map((s) => s.points));
  const ranked = TEMPLATE_SHAPES
    .map((t) => ({
      char: t.char,
      distance: Math.max(1e-9, Math.min(...t.shapes.map((s) => greedyCloudMatch(g.cloud, s.cloud) + ENDPOINT_WEIGHT * chamfer(g.ends, s.ends)))),
    }))
    .sort((a, b) => a.distance - b.distance || (a.char < b.char ? -1 : 1));

  // Scores: inverse squared distance, normalized — for showing the reader how the likeliest readings compare.
  const total = ranked.reduce((s, r) => s + 1 / r.distance ** 2, 0);
  const candidates = ranked.map((r) => ({ char: r.char, score: 1 / r.distance ** 2 / total }));
  const confidence = (ranked[1]!.distance - ranked[0]!.distance) / ranked[1]!.distance;
  return { char: ranked[0]!.char, confidence, candidates };
}

/** Every glyph in the document. */
export function recognizeDoc(doc: HandwritingDoc): Map<Glyph, Recognition> {
  const out = new Map<Glyph, Recognition>();
  for (const block of doc.blocks) {
    const words = block.kind === "matrix" ? block.rows.flatMap((r) => r.cells) : block.words;
    for (const word of words) for (const g of word?.glyphs ?? []) out.set(g, recognizeGlyph(g));
  }
  return out;
}
