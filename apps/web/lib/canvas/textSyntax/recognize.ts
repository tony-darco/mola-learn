/**
 * Reads each segmented glyph as a character, so a model can be handed text
 * instead of bitmaps. What it isn't sure of, it says so (a low confidence)
 * rather than guess: a flagged glyph is cheap for the reader to resolve from
 * context, a confidently wrong one is not.
 *
 * Shape matching is the $P point-cloud recognizer (Vatavu, Anthony &
 * Wobbrock, "Gestures as Point Clouds", ICMI 2012): resample the glyph's
 * strokes to N points, scale uniformly, move the centroid to the origin, and
 * greedily match the cloud against every template (templates.ts), each also
 * leaning a little either way, since people slant their writing. Stroke
 * order, direction, and count don't matter to it.
 *
 * What the point cloud smears out is added back:
 *
 * - Where the strokes end. Both ends of a "3" are on its left; a "2" ends at
 *   the bottom right, after its flat base; a "5" starts at the top right.
 *   Each template's distance also counts how far the glyph's stroke ends are
 *   from the template's (a chamfer distance between the two sets of ends).
 *
 * - Which way the ink runs (see orientations), and how many dots there are:
 *   an "R" has a vertical stem an "A" doesn't; an "i" has a dot, a "÷" two.
 *
 * - Straight strokes. "-", "=" and "+" are made of nothing else, so they are
 *   identified from their strokes directly: one near-horizontal stroke is a
 *   minus, two that don't cross an equals sign, a near-horizontal and a
 *   near-vertical one crossing near their middles a plus (unless it follows
 *   a letter or is as tall as one: that may be a "t"). Nothing else can be a
 *   minus or an equals sign. A glyph that is only a dot is a full stop.
 *
 * - Where the glyph sits on its line. A point cloud has no size, so "c" and
 *   "C", "o", "O" and "°", "x", "X" and "×" are one shape to it. Each
 *   character has a zone on the line (ZONES): capitals and digits run from the
 *   baseline to the cap height, "a" and "x" only to the x-height, "g" and "y"
 *   hang below the baseline, "°" floats at the top. How far the glyph's top
 *   and bottom are from its candidate's zone counts against it. A glyph that
 *   follows another in its word may also be a subscript or a superscript:
 *   the same zone, shrunk and dropped or raised — "H_2O", "x^2".
 *
 * And two kinds of context (recognizeDoc): a matrix of numbers is read as
 * numbers, and one board is one hand — glyphs it reads surely are references
 * for the ones it doesn't.
 *
 * The digit-era constants were tuned on jitter seeds 1–20 of the matrix
 * fixture (evals/canvas-syntax) and checked once on seeds 100–149. The
 * alphabet and everything above that came with it were tuned on seeds 1–20 of
 * the alphabet fixture (evals/canvas-syntax/alphabet.ts) and of the matrix
 * fixture together, and checked once, after, on seeds 300–349.
 */
import type { Glyph, HandwritingDoc, Pt, Word } from "./segment";
import { TEMPLATES } from "./templates";

export type Candidate = { char: string; score: number };
export type Script = "sub" | "sup";
/**
 * `candidates` best first; `score`s sum to 1. `confidence` is the margin
 * between the best two (see below). `script`: the glyph was read as a
 * subscript or superscript of the one before it.
 */
export type Recognition = { char: string; confidence: number; candidates: Candidate[]; script?: Script };

/** Where a glyph sits: its line's baseline (y) and cap height, and whether it follows another glyph in its word (only then can it be a script). */
export type Placement = { baseline: number; cap: number; afterBase: boolean };

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
 * than as a character. With the full alphabet, on tuning seeds 1–20 it
 * flags 2.4% of the matrix fixture's glyphs with no misread left unflagged,
 * and 28% of the alphabet fixture's — whose every line is a trap: case pairs
 * side by side, "l1I 0Oo s5S z2Z" — with 15 of 4,684 misread unflagged,
 * mostly "×" for "x" and back. A lower bar flags fewer but lets more misreads
 * through (0.2: 20% flagged, 30 unflagged misreads).
 */
export const DEFAULT_MIN_CONFIDENCE = 0.25;

/** How much a unit of zone distance (cap heights, top and bottom added) counts against a unit of $P distance. Accuracy on seeds 1–20 is flat from 1.5 to 4. */
const ZONE_WEIGHT = 2.5;
/** Reading a glyph as a script costs this much extra, so a glyph that fits either way stays on the line. */
const SCRIPT_COST = 0.15;
/** A script is this × the line's size, its baseline this far below (subscript) or above (superscript) the line's, in cap heights. */
const SCRIPT_SCALE = 0.65;
const SUB_DROP = 0.2;
const SUP_RISE = 0.4;
/** How much a line's cap height straying from the board's (by a factor of e) costs, against its glyphs' zone distances. */
const CAP_PRIOR = 0.5;
/** Between two readings of the same shape, a zone margin is judged against the runner-up's zone distance plus this much. */
const ZONE_FLOOR = 2;
/** A glyph no bigger than this × the cap height is a dot. */
const DOT = 0.15;
/** A "+" is shorter than this × the cap height; taller, two crossing strokes are a "t". */
const PLUS_MAX = 0.85;
/** A stroke no bigger than this × its glyph is a dot… */
const DOT_STROKE = 0.2;
/** …and each dot more or fewer than a template has counts this much against it. */
const DOT_WEIGHT = 0.6;
/** Direction bins (see orientations), and how much the L1 distance between two glyphs' bins counts. */
const ORIENTATION_BINS = 8;
const ORIENTATION_WEIGHT = 1;
/** Points per cloud in the first, rough pass over every template… */
const ROUGH_N = 16;
/** …which keeps this many characters for the full comparison. */
const SHORTLIST = 12;

/**
 * Each character's zone on its line: where its top and bottom sit, in cap
 * heights above the baseline. Capitals, digits and ascenders fill the line
 * (1 to 0); x-height letters reach about halfway; descenders hang below the
 * baseline; operators float around the middle. Anything not listed is CAP.
 */
type Zone = [top: number, bottom: number];
const CAP: Zone = [1, 0];
const X_HEIGHT: Zone = [0.55, 0];
const DESCENDER: Zone = [0.55, -0.35];
const ZONES: Record<string, Zone> = {
  ...Object.fromEntries([..."acemnorsuvwxzπ"].map((c) => [c, X_HEIGHT])),
  ...Object.fromEntries([..."gpqy"].map((c) => [c, DESCENDER])),
  i: [0.8, 0], j: [0.8, -0.35], t: [0.9, 0], Q: [1, -0.1],
  "(": [1.05, -0.1], ")": [1.05, -0.1], "/": [1, 0],
  "+": [0.75, 0.15], "-": [0.45, 0.45], "=": [0.6, 0.3], "×": [0.7, 0.2], "÷": [0.75, 0.15],
  "→": [0.65, 0.35], "←": [0.65, 0.35], "*": [0.9, 0.45], "^": [1, 0.6], "°": [1, 0.7],
  ",": [0.12, -0.2], ".": [0.1, 0],
};
/** What a matrix of numbers holds, and how sure a reading must be to count as evidence of what a matrix holds. */
const NUMERIC = /^[0-9.\-+\/]$/;
const NUMBERS_SURE = DEFAULT_MIN_CONFIDENCE;
/** A glyph read at least this surely is a reference for its character on its board; at most EXEMPLARS per character, the surest. */
const EXEMPLAR_SURE = 0.25;
const EXEMPLARS = 16;
/** What can be written as a subscript or superscript. */
const SCRIPTABLE = /^[A-Za-z0-9θπΔ+\-*]$/;

/** How far a glyph at `at` is from where `char` would sit, and whether it fits best on the line or as a script. */
function placement(char: string, glyph: Glyph, at: Placement, scriptCost = SCRIPT_COST): { cost: number; script?: Script } {
  const [top, bottom] = ZONES[char] ?? CAP;
  const t = (at.baseline - glyph.box.minY) / at.cap;
  const b = (at.baseline - glyph.box.maxY) / at.cap;
  const off = (zt: number, zb: number) => Math.abs(t - zt) + Math.abs(b - zb);
  let best: { cost: number; script?: Script } = { cost: off(top, bottom) };
  if (at.afterBase && SCRIPTABLE.test(char)) {
    const sub = off(top * SCRIPT_SCALE - SUB_DROP, bottom * SCRIPT_SCALE - SUB_DROP) + scriptCost;
    const sup = off(top * SCRIPT_SCALE + SUP_RISE, bottom * SCRIPT_SCALE + SUP_RISE) + scriptCost;
    if (sub < best.cost) best = { cost: sub, script: "sub" };
    if (sup < best.cost) best = { cost: sup, script: "sup" };
  }
  return best;
}

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
function shape(all: Pt[][], n = N): { cloud: CloudPt[]; ends: CloudPt[]; dots: number; turns: number[] } {
  // Dots are counted, not drawn: a dot's few points would weigh in the cloud as much as a stroke's.
  const dotted = dotStrokes(all);
  const strokes = all.filter((s) => !dotted.has(s));
  const points = resample(strokes, n);
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1;
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  const place = (p: Pt) => ({ x: (p.x - cx) / size, y: (p.y - cy) / size });
  return { cloud: points.map(place), ends: all.flatMap((s) => [place(s[0]!), place(s[s.length - 1]!)]), dots: dotted.size, turns: orientations(strokes, size) };
}

/**
 * Which way the ink runs, ignoring direction: the share of the strokes'
 * length in each of ORIENTATION_BINS bins of angle (0–180°), each step split
 * between its two nearest bins. Steps are a fifth of the glyph's size, long
 * enough to ride over a shaky hand's tremor. An "R" has a vertical stem that
 * an "A" doesn't; a "5" and a "Z" have straight bars an "S" and a "2" don't.
 */
function orientations(strokes: Pt[][], size: number): number[] {
  const bins = new Array<number>(ORIENTATION_BINS).fill(0);
  const step = 0.2 * size;
  for (const stroke of strokes) {
    let from = stroke[0]!;
    const flush = (to: Pt) => {
      const len = Math.hypot(to.x - from.x, to.y - from.y);
      if (len === 0) return;
      const pos = ((((Math.atan2(to.y - from.y, to.x - from.x) + Math.PI) % Math.PI) / Math.PI) * ORIENTATION_BINS) % ORIENTATION_BINS;
      const lo = Math.floor(pos);
      bins[lo] = bins[lo]! + len * (1 - (pos - lo));
      bins[(lo + 1) % ORIENTATION_BINS] = bins[(lo + 1) % ORIENTATION_BINS]! + len * (pos - lo);
      from = to;
    };
    for (const p of stroke) if (Math.hypot(p.x - from.x, p.y - from.y) >= step) flush(p);
    flush(stroke[stroke.length - 1]!);
  }
  const total = bins.reduce((a, b) => a + b, 0) || 1;
  return bins.map((b) => b / total);
}

const orientationDistance = (a: number[], b: number[]) => a.reduce((s, v, i) => s + Math.abs(v - b[i]!), 0);

/** Strokes that are only a dot next to the whole glyph — the dot of an "i", the two of a "÷". */
function dotStrokes(strokes: Pt[][]): Set<Pt[]> {
  const extent = (pts: Pt[]) => Math.max(Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y)));
  const size = extent(strokes.flat());
  return new Set(strokes.length < 2 ? [] : strokes.filter((s) => extent(s) <= DOT_STROKE * size));
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

/** `bound`: a distance already found elsewhere — matching gives up as soon as it can't beat it. */
function greedyCloudMatch(points: CloudPt[], template: CloudPt[], bound = Infinity): number {
  const step = Math.floor(Math.sqrt(points.length));
  let best = bound;
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

/** People slant their writing: every template is also matched leaning this many degrees either way (±8 beat ±12 and ±6/±12 on seeds 1–20). */
const SLANTS = [0, -8, 8];
const TEMPLATE_SHAPES = Object.entries(TEMPLATES).map(([char, variants]) => {
  const strokes = variants.flatMap((v) => SLANTS.map((deg) => {
    const k = Math.tan((deg * Math.PI) / 180);
    return v.map((s) => s.map(([x, y]) => ({ x: x - k * y, y })));
  }));
  // The rough pass only picks the shortlist, so the upright variants do for it.
  const upright = variants.map((v) => v.map((s) => s.map(([x, y]) => ({ x, y }))));
  return { char, shapes: strokes.map((v) => shape(v)), rough: upright.map((v) => shape(v, ROUGH_N)) };
});

/**
 * The distance to the nearest of a character's variants: $P, plus the stroke-end, dot and direction
 * terms (`scale` × $P, for a rougher cloud). Each variant's $P search gives up once it can't beat the nearest so far.
 */
function shapeDistance(g: Shape, variants: Shape[], scale = 1): number {
  let best = Infinity;
  for (const s of variants) {
    const rest = ENDPOINT_WEIGHT * chamfer(g.ends, s.ends) + DOT_WEIGHT * Math.abs(g.dots - s.dots) + ORIENTATION_WEIGHT * orientationDistance(g.turns, s.turns);
    if (rest >= best) continue;
    best = Math.min(best, scale * greedyCloudMatch(g.cloud, s.cloud, (best - rest) / scale) + rest);
  }
  return best;
}

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

/** This board's own confidently read glyphs, as extra references for their characters (see recognizeDoc). */
type Exemplars = Map<string, { full: Shape; rough: Shape }[]>;
type Shape = ReturnType<typeof shape>;

/**
 * Confidence is the relative margin between the best and the next
 * differently shaped character, (d₂ − d₁) / d₂: 0 when two characters fit
 * equally well, near 1 when only one fits at all. Between characters of one
 * shape ("c" and "C"), only the zones can differ, so the margin there is the
 * zones' alone (see ZONE_FLOOR); the confidence is the smaller of the two.
 * A glyph identified by its straight strokes gets 1. `allowed` limits the
 * characters it can be; `exemplars` are this board's references.
 */
export function recognizeGlyph(glyph: Glyph, at?: Placement, allowed?: RegExp, exemplars?: Exemplars): Recognition {
  const sure = (char: string, confidence = 1): Recognition => {
    const script = at && confidence === 1 ? placement(char, glyph, at).script : undefined;
    return { char, confidence, candidates: [{ char, score: 1 }], ...(script ? { script } : {}) };
  };
  const box = glyph.box;
  // A dot is a full stop; one off the baseline is something else (a multiplication dot), so it is shown as unsure.
  if (at && Math.max(box.maxX - box.minX, box.maxY - box.minY) <= DOT * at.cap) {
    return sure(".", (at.baseline - box.maxY) / at.cap < 0.35 ? 1 : 0);
  }
  // A "+" is certain on its own; right after a letter, or as tall as one, it may be a "t".
  const straight = straightStrokeChar(glyph);
  if (straight && !(straight === "+" && at && (at.afterBase || box.maxY - box.minY > PLUS_MAX * at.cap))) return sure(straight);

  // A rough pass over every template picks the shortlist the full comparison ranks. The rough
  // distance is doubled: $P distances grow with the number of points.
  const strokes = glyph.strokes.map((s) => s.points);
  const fit = (char: string) => (at ? placement(char, glyph, at) : { cost: 0 });
  const rough = shape(strokes, ROUGH_N);
  const shortlist = TEMPLATE_SHAPES
    .filter((t) => !allowed || allowed.test(t.char))
    .map((t) => ({
      t,
      d: shapeDistance(rough, [...t.rough, ...(exemplars?.get(t.char) ?? []).map((e) => e.rough)], 2) + ZONE_WEIGHT * fit(t.char).cost,
    }))
    .sort((a, b) => a.d - b.d)
    .slice(0, SHORTLIST);
  const g = shape(strokes);
  const ranked = shortlist
    .map(({ t }) => {
      const f = fit(t.char);
      const references = [...t.shapes, ...(exemplars?.get(t.char) ?? []).map((e) => e.full)];
      return { char: t.char, script: f.script, zone: f.cost, distance: Math.max(1e-9, shapeDistance(g, references) + ZONE_WEIGHT * f.cost) };
    })
    .sort((a, b) => a.distance - b.distance || (a.char < b.char ? -1 : 1));

  // Scores: inverse squared distance, normalized — for showing the reader how the likeliest readings compare.
  const total = ranked.reduce((s, r) => s + 1 / r.distance ** 2, 0);
  const candidates = ranked.map((r) => ({ char: r.char, score: 1 / r.distance ** 2 / total }));
  // Against a differently shaped reading, the margin between the two (relative to the other's
  // distance); against one of the same shape ("c" and "C"), only the zones differ, so only they count.
  const [best, ...rest] = ranked;
  const twin = rest.find((r) => TEMPLATES[r.char] === TEMPLATES[best!.char]);
  const other = rest.find((r) => TEMPLATES[r.char] !== TEMPLATES[best!.char]);
  const byShape = other ? (other.distance - best!.distance) / other.distance : 1;
  const byZone = twin ? (ZONE_WEIGHT * (twin.zone - best!.zone)) / (ZONE_WEIGHT * twin.zone + ZONE_FLOOR) : 1;
  const confidence = Math.min(byShape, byZone);
  const script = ranked[0]!.script;
  return { char: ranked[0]!.char, confidence, candidates, ...(script ? { script } : {}) };
}

// ── lines ───────────────────────────────────────────────────────────────────

const glyphHeight = (g: Glyph) => g.box.maxY - g.box.minY;
const glyphWidth = (g: Glyph) => g.box.maxX - g.box.minX;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

/** Glyphs with some height to them — not a minus, an equals sign, a dot. */
const upright = (g: Glyph) => glyphHeight(g) >= 0.35 * glyphWidth(g);

/**
 * A line's own cap height: the typical height of its tallest glyphs (those
 * at least 0.6 × the tallest), and how many upright glyphs it was taken from.
 */
function lineCap(words: Word[]): { cap: number; count: number } {
  const heights = words.flatMap((w) => w.glyphs).filter(upright).map(glyphHeight);
  if (heights.length === 0) return { cap: 0, count: 0 };
  const tallest = Math.max(...heights);
  return { cap: median(heights.filter((h) => h >= 0.6 * tallest)), count: heights.length };
}

/** One character per distinct zone — enough to ask where a glyph could sit, whatever it is. */
const ZONE_CHARS = ["A", ...new Map(Object.entries(ZONES).map(([c, z]) => [`${z}${SCRIPTABLE.test(c)}`, c])).values()];
/**
 * In finding a line, a script costs only this, and so does a floating
 * operator's zone: a line's letters, nudged up, can always pass for
 * operators, and its scripts for letters on a line of their own.
 */
const LINE_SCRIPT_COST = 0.05;
const LINE_OPERATOR_COST = 0.1;
const OPERATORS = /^[+\-=×÷→←*^°]$/;
const lineFit = (c: string, g: Glyph, at: Placement) => placement(c, g, at, LINE_SCRIPT_COST).cost + (OPERATORS.test(c) ? LINE_OPERATOR_COST : 0);

/**
 * Where a line's glyphs sit: the baseline and cap height that let its glyphs
 * sit best, each in some character's zone. The baseline is tried at the
 * bottom of each of its glyphs, so descenders, superscripts and operators —
 * which all have bottoms of their own — don't drag it with them. The cap
 * height is the line's own (see lineCap) or the board's (`boardCap`), with
 * a small lean toward the board's: a lone "v" or a line of "ace" fits a
 * line of its own size as capitals just as well, and is told apart only by
 * being smaller than the writing around it.
 */
function linePlacement(words: Word[], boardCap: number): { baseline: number; cap: number } {
  const own = lineCap(words);
  const glyphs = words.flatMap((w) => w.glyphs.map((g, i) => ({ g, afterBase: i > 0 }))).filter(({ g }) => upright(g));
  if (glyphs.length === 0) return { baseline: Math.max(...words.flatMap((w) => w.glyphs.map((g) => g.box.maxY))), cap: boardCap };
  let best = { baseline: glyphs[0]!.g.box.maxY, cap: boardCap, cost: Infinity };
  for (const cap of own.cap > 0 && own.cap !== boardCap ? [boardCap, own.cap] : [boardCap]) {
    const prior = CAP_PRIOR * Math.abs(Math.log(cap / boardCap));
    for (const { g: candidate } of glyphs) {
      const baseline = candidate.box.maxY;
      // Each glyph at most 1: one that fits nowhere shouldn't outweigh the rest.
      const cost = prior + glyphs.reduce((sum, { g, afterBase }) =>
        sum + Math.min(1, ...ZONE_CHARS.map((c) => lineFit(c, g, { baseline, cap, afterBase }))), 0);
      if (cost < best.cost - 1e-9) best = { baseline, cap, cost };
    }
  }
  // The best candidate is one glyph's bottom, jitter and all; the baseline is where the glyphs sitting on it agree.
  const sitting = glyphs.filter(({ g, afterBase }) => {
    const at = { baseline: best.baseline, cap: best.cap, afterBase };
    const fits = ZONE_CHARS.map((c) => ({ c, cost: lineFit(c, g, at), script: placement(c, g, at, LINE_SCRIPT_COST).script }))
      .sort((x, y) => x.cost - y.cost)[0]!;
    return !fits.script && (ZONES[fits.c] ?? CAP)[1] === 0;
  });
  return { baseline: sitting.length ? median(sitting.map(({ g }) => g.box.maxY)) : best.baseline, cap: best.cap };
}

/**
 * Every glyph in the document, each read against its line (a line of text,
 * or a matrix row). A matrix whose entries, where the recognizer is sure of
 * them, are all numbers is a matrix of numbers: the entries it isn't sure of
 * are read again as numbers only. One sure letter anywhere in it (a matrix of
 * variables) and it is left as read.
 */
export function recognizeDoc(doc: HandwritingDoc): Map<Glyph, Recognition> {
  const rowsOf = (b: HandwritingDoc["blocks"][number]) => (b.kind === "matrix" ? b.rows.map((r) => r.cells.filter((c): c is Word => !!c)) : [b.words]);
  const lines = doc.blocks.flatMap(rowsOf).filter((words) => words.length > 0);
  // The board's cap height: the typical line's, counting only lines with a few upright glyphs if there are any.
  const caps = lines.map(lineCap).filter((c) => c.count > 0);
  const sure = caps.filter((c) => c.count >= 3);
  const boardCap = (sure.length ? median(sure.map((c) => c.cap)) : caps.length ? median(caps.map((c) => c.cap)) : 1) || 1;

  const out = new Map<Glyph, Recognition>();
  const placements = new Map<Word, { baseline: number; cap: number }>();
  const numericBlocks = new Set<HandwritingDoc["blocks"][number]>();
  for (const words of lines) {
    const { baseline, cap } = linePlacement(words, boardCap);
    for (const word of words) word.glyphs.forEach((g, i) => out.set(g, recognizeGlyph(g, { baseline, cap, afterBase: i > 0 })));
    placements.set(words[0]!, { baseline, cap });
  }
  for (const block of doc.blocks) {
    if (block.kind !== "matrix") continue;
    const rows = rowsOf(block).filter((words) => words.length > 0);
    const glyphs = rows.flatMap((words) => words.flatMap((w) => w.glyphs));
    const sure = glyphs.map((g) => out.get(g)!).filter((r) => r.confidence >= NUMBERS_SURE);
    if (sure.length === 0 || !sure.every((r) => NUMERIC.test(r.char))) continue;
    numericBlocks.add(block);
    for (const words of rows) {
      const { baseline, cap } = placements.get(words[0]!)!;
      for (const word of words) word.glyphs.forEach((g, i) => {
        if (out.get(g)!.confidence < NUMBERS_SURE) out.set(g, recognizeGlyph(g, { baseline, cap, afterBase: i > 0 }, NUMERIC));
      });
    }
  }

  // One hand writes a board: the glyphs read surely become references for their characters, and the unsure ones are read again with them.
  const surest = [...out].filter(([, r]) => r.confidence >= EXEMPLAR_SURE)
    .sort(([ga, a], [gb, b]) => b.confidence - a.confidence || ga.box.minY - gb.box.minY || ga.box.minX - gb.box.minX);
  const exemplars: Exemplars = new Map();
  for (const [g, r] of surest) {
    const list = exemplars.get(r.char) ?? [];
    if (list.length >= EXEMPLARS) continue;
    const strokes = g.strokes.map((st) => st.points);
    exemplars.set(r.char, [...list, { full: shape(strokes), rough: shape(strokes, ROUGH_N) }]);
  }
  if (exemplars.size === 0) return out;
  for (const words of lines) {
    const { baseline, cap } = placements.get(words[0]!)!;
    for (const word of words) word.glyphs.forEach((g, i) => {
      if (out.get(g)!.confidence >= DEFAULT_MIN_CONFIDENCE) return;
      const block = doc.blocks.find((b) => rowsOf(b).some((ws) => ws.includes(word)))!;
      out.set(g, recognizeGlyph(g, { baseline, cap, afterBase: i > 0 }, numericBlocks.has(block) ? NUMERIC : undefined, exemplars));
    });
  }
  return out;
}
