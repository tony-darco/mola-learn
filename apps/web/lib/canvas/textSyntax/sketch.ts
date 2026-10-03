/**
 * Pen drawings — ink that is neither writing nor a mark about writing — as
 * parts a model can picture without seeing them: straight lines, corners,
 * closed shapes, arcs, curves, zigzags, coils, wedges, dashed and parallel
 * lines, dots, arrows and which way they point; which of them join, and how
 * — at a right angle, end to end round a closed ring, a small part across
 * another's corner; and the written labels beside them. Nothing here says
 * what a drawing depicts: that is the reader's to work out.
 *
 * Strokes are taken for drawing (findDrawings) when they are bigger than
 * writing, or join a drawing by touching it; small strokes in a row along a
 * line are a dashed line. Pen marks (marks.ts) that join a drawing or lie
 * inside it become parts of it. Writing near a drawing that is short — a
 * label, not a sentence — becomes its label (attachLabels).
 *
 * Geometry only, and every distance is a multiple of the typical stroke size
 * (`unit`, see strokeUnit), as in segment.ts and marks.ts.
 */
import { arrowInOneStroke, type PenMark } from "./marks";
import { boxOf, centerX, centerY, height, union, width, type Box, type Ink, type Pt, type TextBlock, type Word } from "./segment";

export type PartKind =
  | "segment" | "polyline" | "arrow" | "circle" | "triangle" | "rectangle" | "polygon"
  | "arc" | "curve" | "zigzag" | "coil" | "wedge" | "dashed" | "parallel" | "dot";

/**
 * One part of a drawing. `points` are what define it, in canvas coordinates:
 * a segment's two ends; a polyline's, arc's, curve's, zigzag's or coil's
 * start, corners or turns, and end; an arrow's tail and head; a closed
 * shape's corners in drawing order; a wedge's point and the middle of its
 * wide end; a dashed line's first and last dash; parallel lines' ends (of the
 * longest); a dot's centre. Circles have a `centre` and `across` (width,
 * height) instead.
 */
export type Part = {
  kind: PartKind;
  strokes: Ink[];
  points: Pt[];
  centre?: Pt;
  across?: [number, number];
  /** polygon: sides. polyline: corners. zigzag: turns. coil: loops. parallel: lines. dashed: dashes. */
  count?: number;
  /** polyline, triangle, rectangle, polygon: which of its `points` are corners at a right angle (see RIGHT). */
  right?: number[];
  /** For checking joins: every point of its ink. */
  ink: Pt[];
};

// ── constants (× unit, unless said otherwise) ───────────────────────────────

/** A stroke this big is drawing, not writing… */
const SEED = 2.2;
/** …unless it is alone and looks like it could be a character: a lone loop or squiggle must be this big. */
const LONE = 4;
/** Ink this close touches. */
const REACH = 0.3;
/** Parts this close belong to one drawing. */
const GROUP_GAP = 1.5;
/** A dash is between DASH_MIN and DASH in size; a dashed line has at least DASHES of them, at most DASH_GAP apart. */
const DASH = 1;
const DASH_MIN = 0.1;
const DASHES = 3;
const DASH_GAP = 1.2;
/** A dot is no bigger than this. */
const DOT = 0.45;
/** Two straight lines are parallel parts when they lie within this of each other, at most PARALLEL_DEG apart in direction. */
const PARALLEL_GAP = 0.9;
const PARALLEL_DEG = 12;
/** A stroke closes when its ends (or its end and any of its first fifth) come within this × its size. */
const CLOSE = 0.22;
/** A stroke is straight when nothing strays from the line between its ends by more than this × that line's length (or STRAIGHT_MIN × the unit, for a short one). */
const STRAIGHT = 0.06;
const STRAIGHT_MIN = 0.15;
/** Corners: where a simplified stroke turns by at least this many degrees, turns within CORNER_SPAN × its size of each other counting as one. Simplified to within SIMPLIFY × its size. */
const CORNER_DEG = 35;
const CORNER_SPAN = 0.05;
const SIMPLIFY = 0.03;
/** The lines an angle's mark rests on run at least this many degrees apart. */
const ANGLE_APART = 15;
/** A triangle whose shortest side is at most this × its longest is a wedge. */
const NARROW = 0.4;
/** A closed stroke is round when its points keep, on average, within this share of its radius from an ellipse in its box. */
const ROUND = 0.08;
/** A closed stroke with corners has straight sides when its points keep, on average, within this × its size of the lines between them. */
const SIDES = 0.04;
/**
 * A line that bows by at least this × its length — and BOW_MIN × the unit,
 * three times its tremor — is an arc on its own. (A short one bowing less
 * can't be told from a tremor; see angleMarks.)
 */
const BOW = 0.12;
const BOW_MIN = 0.1;
/**
 * In a drawing, an arrow drawn in one stroke may have a head up to this share
 * of its shaft (a short force arrow, say), and barbs reaching out only this
 * far (× unit) to each side: a small head on a long shaft, drawn quickly. (At
 * marks.ts's 0.15, 2 of the 100 one-stroke arrows of seeds 1–20 of the
 * diagram board came out as a line, or a line with corners; from 0.08 to 0.1,
 * none did.)
 */
const HEAD_SHARE = 0.8;
const HEAD_SPREAD = 0.1;
/**
 * An angle within this many degrees of 90 is a right angle. On seeds 1–20 of
 * the diagram board, 390 of the 400 corners drawn square are within it (the
 * rest are corners of the shaky car body, placed off by its tremor), and 2 of
 * the 320 drawn at least 15° off are.
 */
const RIGHT = 12;

// ── geometry ────────────────────────────────────────────────────────────────

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const sizeOf = (b: Box) => Math.max(width(b), height(b));
const pathLength = (pts: Pt[]) => pts.reduce((s, p, i) => (i ? s + dist(p, pts[i - 1]!) : 0), 0);

/** Degrees turned from direction a→b to b→c, signed (positive = clockwise on screen). */
function turn(a: Pt, b: Pt, c: Pt): number {
  const u = sub(b, a);
  const v = sub(c, b);
  return (Math.atan2(cross(u, v), u.x * v.x + u.y * v.y) * 180) / Math.PI;
}

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2));
  return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)));
}

/** Distance from `p` to a polyline (a single point counts as one). */
export function distToPath(p: Pt, path: Pt[]): number {
  if (path.length === 1) return dist(p, path[0]!);
  let best = Infinity;
  for (let i = 1; i < path.length; i++) best = Math.min(best, distToSegment(p, path[i - 1]!, path[i]!));
  return best;
}

/** Nearest approach of two inks, each a polyline. */
function inkDistance(a: Pt[], b: Pt[]): number {
  return Math.min(...a.map((p) => distToPath(p, b)), ...b.map((p) => distToPath(p, a)));
}

const boxGap = (a: Box, b: Box) => Math.hypot(Math.max(0, a.minX - b.maxX, b.minX - a.maxX), Math.max(0, a.minY - b.maxY, b.minY - a.maxY));

/** Douglas–Peucker: the fewest points that keep the path within `eps` of where it was. */
function simplify(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0]!, pts[pts.length - 1]!];
  let worst = 0;
  let at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distToSegment(pts[i]!, a, b);
    if (d > worst) [worst, at] = [d, i];
  }
  if (worst <= eps) return [a, b];
  return [...simplify(pts.slice(0, at + 1), eps).slice(0, -1), ...simplify(pts.slice(at), eps)];
}

/**
 * Corners of a simplified path (`size`: its stroke's): where it turns by at
 * least CORNER_DEG (ends not included). A turn that tremor split over points
 * close together (CORNER_SPAN × size) counts once, by its total, and corners
 * that close are one.
 */
function corners(path: Pt[], size: number): Pt[] {
  const out: Pt[] = [];
  let run = 0;
  for (let i = 1; i < path.length - 1; i++) {
    const t = turn(path[i - 1]!, path[i]!, path[i + 1]!);
    run = Math.sign(t) === Math.sign(run) && dist(path[i]!, path[i - 1]!) < CORNER_SPAN * size ? run + t : t;
    if (Math.abs(run) < CORNER_DEG) continue;
    const last = out[out.length - 1];
    if (last && dist(last, path[i]!) < CORNER_SPAN * size) out[out.length - 1] = mid(last, path[i]!);
    else out.push(path[i]!);
    run = 0;
  }
  return out;
}

/** The angle (0–180°) at `v` between the directions to `a` and to `b`. */
function angleAt(v: Pt, a: Pt, b: Pt): number {
  const [u, w] = [sub(a, v), sub(b, v)];
  const n = Math.hypot(u.x, u.y) * Math.hypot(w.x, w.y);
  return n === 0 ? 0 : (Math.acos(Math.max(-1, Math.min(1, (u.x * w.x + u.y * w.y) / n))) * 180) / Math.PI;
}

/** Which of a path's corners are right angles: of a closed one, every point; of an open one, the inner ones. */
function rightCorners(points: Pt[], isClosed: boolean): number[] {
  const n = points.length;
  const inner = isClosed ? points.map((_, i) => i) : points.slice(1, -1).map((_, i) => i + 1);
  return inner.filter((i) => Math.abs(angleAt(points[i]!, points[(i - 1 + n) % n]!, points[(i + 1) % n]!) - 90) <= RIGHT);
}

function pointInLoop(p: Pt, loop: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [a, b] = [loop[i]!, loop[j]!];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** If the stroke comes back round to where it started, the closed outline (any overshoot cut off); otherwise null. */
function closedOutline(pts: Pt[], size: number): Pt[] | null {
  const start = pts[0]!;
  const length = pathLength(pts);
  let walked = 0;
  let best: { i: number; d: number } | null = null;
  for (let i = 1; i < pts.length; i++) {
    walked += dist(pts[i]!, pts[i - 1]!);
    if (walked < 0.6 * length) continue;
    const d = dist(pts[i]!, start);
    if (d <= CLOSE * size && (!best || d < best.d)) best = { i, d };
  }
  return best ? pts.slice(0, best.i + 1) : null;
}

/** The circle through three points, or null if they are in a line. */
function circleThrough(a: Pt, b: Pt, c: Pt): { centre: Pt; r: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) return null;
  const sq = (p: Pt) => p.x * p.x + p.y * p.y;
  const centre = {
    x: (sq(a) * (b.y - c.y) + sq(b) * (c.y - a.y) + sq(c) * (a.y - b.y)) / d,
    y: (sq(a) * (c.x - b.x) + sq(b) * (a.x - c.x) + sq(c) * (b.x - a.x)) / d,
  };
  return { centre, r: dist(centre, a) };
}

/** The point `t` (0–1) of the way along a path. */
function along(pts: Pt[], t: number): Pt {
  let left = t * pathLength(pts);
  for (let i = 1; i < pts.length; i++) {
    const step = dist(pts[i]!, pts[i - 1]!);
    if (step >= left && step > 0) return { x: pts[i - 1]!.x + ((pts[i]!.x - pts[i - 1]!.x) * left) / step, y: pts[i - 1]!.y + ((pts[i]!.y - pts[i - 1]!.y) * left) / step };
    left -= step;
  }
  return pts[pts.length - 1]!;
}

// ── one stroke, as a part ───────────────────────────────────────────────────

/** What a single stroke is, by its shape alone. */
export function fitStroke(ink: Ink, unit: number): Part {
  const pts = ink.points;
  const size = sizeOf(ink.box);
  const base = { strokes: [ink], ink: pts };
  if (size <= DOT * unit) return { ...base, kind: "dot", points: [{ x: centerX(ink.box), y: centerY(ink.box) }] };

  const outline = closedOutline(pts, size);
  if (outline) {
    const b = boxOf(outline);
    const [cx, cy, rx, ry] = [centerX(b), centerY(b), width(b) / 2 || 1, height(b) / 2 || 1];
    const off = outline.reduce((sum, p) => sum + Math.abs(Math.hypot((p.x - cx) / rx, (p.y - cy) / ry) - 1), 0) / outline.length;
    if (off <= ROUND) return { ...base, kind: "circle", points: [], centre: { x: cx, y: cy }, across: [width(b), height(b)] };
    const ring = simplify(outline, SIMPLIFY * size);
    // Corners of the closed ring: look across where it starts and ends, too.
    const loop = [...ring.slice(0, -1), ...ring.slice(0, 2)];
    // In drawing order: from the corner nearest where the pen started, so sides are numbered as they were drawn.
    const unordered = corners(loop, size);
    const first = unordered.reduce((best, c, i) => (dist(c, pts[0]!) < dist(unordered[best]!, pts[0]!) ? i : best), 0);
    const found = [...unordered.slice(first), ...unordered.slice(0, first)];
    // Straight sides between its corners, or it is round after all (a narrow, wobbly "0").
    const sided = [...found, found[0]!];
    if (found.length >= 3 && outline.reduce((sum, p) => sum + distToPath(p, sided), 0) / outline.length <= SIDES * size) {
      if (found.length === 3) {
        const sides = found.map((p, i) => dist(p, found[(i + 1) % 3]!));
        const shortest = Math.min(...sides);
        if (shortest <= NARROW * Math.max(...sides)) {
          const k = sides.indexOf(shortest);
          const point = found[(k + 2) % 3]!;
          return { ...base, kind: "wedge", points: [point, mid(found[k]!, found[(k + 1) % 3]!)] };
        }
        return { ...base, kind: "triangle", points: found, right: rightCorners(found, true) };
      }
      return { ...base, kind: found.length === 4 ? "rectangle" : "polygon", points: found, count: found.length, right: rightCorners(found, true) };
    }
    return { ...base, kind: "circle", points: [], centre: { x: cx, y: cy }, across: [width(b), height(b)] };
  }

  // An arrow drawn in one stroke, before straightness: a small head on a long shaft strays from its line less than a line may.
  const arrow = arrowInOneStroke(pts, unit, HEAD_SHARE, HEAD_SPREAD);
  if (arrow) return { ...base, kind: "arrow", points: [arrow.tail, arrow.tip] };

  const [a, z] = [pts[0]!, pts[pts.length - 1]!];
  const chord = dist(a, z);
  if (chord > 0 && Math.max(...pts.map((p) => distToSegment(p, a, z))) <= Math.max(STRAIGHT * chord, STRAIGHT_MIN * unit)) {
    // Nearly straight — unless it bows evenly one way, like the arc marking a narrow angle.
    const m = along(pts, 0.5);
    const c = circleThrough(a, m, z);
    const sagitta = distToSegment(m, a, z);
    const tremor = c ? Math.sqrt(pts.reduce((s, p) => s + (dist(p, c.centre) - c.r) ** 2, 0) / pts.length) : Infinity;
    if (c && sagitta >= BOW * chord && sagitta >= BOW_MIN * unit && sagitta >= 3 * tremor) return { ...base, kind: "arc", points: [a, m, z], centre: c.centre };
    return { ...base, kind: "segment", points: [a, z] };
  }
  const path = simplify(pts, SIMPLIFY * size);
  const found = corners(path, size);
  // A coil turns round and round; a zigzag turns sharply back and forth.
  const turning = path.slice(1, -1).reduce((s, p, i) => s + turn(path[i]!, p, path[i + 2]!), 0);
  if (Math.abs(turning) >= 2 * 360) return { ...base, kind: "coil", points: [a, z], count: Math.round(Math.abs(turning) / 360) };
  const signs = found.map((p) => {
    // A corner merged from two close turns is their midpoint, not a vertex of
    // the path — so take the nearest interior vertex rather than indexOf(),
    // which returned -1 and crashed the whole read on some shaky strokes.
    let i = 1;
    for (let k = 2; k < path.length - 1; k++) if (dist(path[k]!, p) < dist(path[i]!, p)) i = k;
    return Math.sign(turn(path[i - 1]!, path[i]!, path[i + 1]!));
  });
  const alternating = signs.slice(1).filter((s, i) => s !== signs[i]).length;
  if (found.length >= 4 && alternating >= 0.75 * (found.length - 1)) return { ...base, kind: "zigzag", points: [a, ...found, z], count: found.length };
  if (found.length >= 1) return { ...base, kind: "polyline", points: [a, ...found, z], count: found.length, right: rightCorners([a, ...found, z], false) };

  // Smooth: an arc if it keeps to one circle, otherwise a curve.
  const c = circleThrough(a, along(pts, 0.5), z);
  if (c && pts.every((p) => Math.abs(dist(p, c.centre) - c.r) <= 0.1 * c.r)) return { ...base, kind: "arc", points: [a, along(pts, 0.5), z], centre: c.centre };
  return { ...base, kind: "curve", points: [a, along(pts, 0.25), along(pts, 0.5), along(pts, 0.75), z] };
}

// ── finding drawings ────────────────────────────────────────────────────────

/** A drawing as found: its parts, and every stroke it holds (marks' included). */
export type DrawingDraft = { parts: Part[]; strokes: Ink[]; box: Box };

/** Straight, if it has length to it: nothing strays from the line between its ends by more than this share of it (or a pixel, for a tiny one). */
function straightish(ink: Ink): boolean {
  const pts = ink.points;
  const [a, z] = [pts[0]!, pts[pts.length - 1]!];
  const chord = dist(a, z);
  return chord > 0 && pts.every((p) => distToSegment(p, a, z) <= Math.max(0.15 * chord, 1));
}

/** The direction (radians, 0–π) of `ink` where it passes nearest to `p`. */
function directionNear(ink: Ink, p: Pt): number {
  let best = { d: Infinity, angle: 0 };
  for (let i = 1; i < ink.points.length; i++) {
    const [a, b] = [ink.points[i - 1]!, ink.points[i]!];
    const d = distToSegment(p, a, b);
    if (d < best.d && dist(a, b) > 0) best = { d, angle: (Math.atan2(b.y - a.y, b.x - a.x) + Math.PI) % Math.PI };
  }
  return best.angle;
}

/**
 * Small straight strokes in an evenly spaced row along a line: dashed lines.
 * A dash touches no other small straight stroke — those are the strokes of
 * an "H" or an "E", written in a row.
 */
function dashedRuns(inks: Ink[], unit: number): Ink[][] {
  const small = inks.filter((ink) => {
    const size = sizeOf(ink.box);
    return size <= DASH * unit && size >= DASH_MIN * unit && straightish(ink);
  });
  const dashes = small.filter((ink) => !small.some((o) => o !== ink && boxGap(o.box, ink.box) <= REACH * unit && inkDistance(o.points, ink.points) <= REACH * unit));
  const centre = (i: Ink) => ({ x: centerX(i.box), y: centerY(i.box) });
  const groups = groupBy(dashes, (a, b) => dist(centre(a), centre(b)) <= DASH_GAP * unit);
  return groups.filter((g) => {
    if (g.length < DASHES) return false;
    // Collinear centres, evenly spaced: order them along the line through the two furthest apart.
    const cs = g.map(centre);
    let [p, q] = [cs[0]!, cs[1]!];
    for (const a of cs) for (const b of cs) if (dist(a, b) > dist(p, q)) [p, q] = [a, b];
    const along = cs.map((c) => ({ c, t: ((c.x - p.x) * (q.x - p.x) + (c.y - p.y) * (q.y - p.y)) / (dist(p, q) ** 2 || 1) })).sort((a, b) => a.t - b.t);
    const gaps = along.slice(1).map((a, i) => dist(a.c, along[i]!.c));
    const off = Math.max(...cs.map((c) => distToSegment(c, p, q)));
    return off <= 0.35 * (dist(p, q) / (g.length - 1)) && Math.max(...gaps) <= 2.5 * Math.min(...gaps);
  });
}

/** Partitions `items` into connected groups, where `linked(a, b)` joins two items. Group order follows first appearance. */
function groupBy<T>(items: T[], linked: (a: T, b: T) => boolean): T[][] {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) if (find(i) !== find(j) && linked(items[i]!, items[j]!)) parent[find(j)] = find(i);
  }
  const groups = new Map<number, T[]>();
  items.forEach((item, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), item]));
  return [...groups.values()];
}

/** A pen mark taken into a drawing, as a part. */
function markPart(mark: PenMark, unit: number): Part {
  const ink = mark.strokes.flatMap((s) => s.points);
  if (mark.kind === "arrow") return { kind: "arrow", strokes: mark.strokes, points: [mark.tail, mark.tip], ink };
  return fitStroke(mark.strokes[0]!, unit);
}

/** Straight lines lying side by side become one part: two or three parallel lines. */
function pairParallels(parts: Part[], unit: number): Part[] {
  const lines = parts.filter((p) => p.kind === "segment");
  const dir = (p: Part) => Math.atan2(p.points[1]!.y - p.points[0]!.y, p.points[1]!.x - p.points[0]!.x);
  const sideBySide = (a: Part, b: Part) => {
    let d = Math.abs(dir(a) - dir(b)) % Math.PI;
    d = Math.min(d, Math.PI - d);
    if ((d * 180) / Math.PI > PARALLEL_DEG) return false;
    const [a0, a1] = a.points as [Pt, Pt];
    const la = dist(a0, a1);
    const ux = (a1.x - a0.x) / la;
    const uy = (a1.y - a0.y) / la;
    const proj = (p: Pt) => (p.x - a0.x) * ux + (p.y - a0.y) * uy;
    const off = Math.abs(cross({ x: ux, y: uy }, sub(mid(b.points[0]!, b.points[1]!), a0)));
    const [s, e] = [proj(b.points[0]!), proj(b.points[1]!)].sort((x, y) => x - y) as [number, number];
    const overlap = Math.min(la, e) - Math.max(0, s);
    return off >= 0.15 * unit && off <= PARALLEL_GAP * unit && overlap >= 0.5 * Math.min(la, e - s);
  };
  const groups = groupBy(lines, sideBySide).filter((g) => g.length >= 2 && g.length <= 3);
  const paired = new Set(groups.flat());
  return [
    ...parts.filter((p) => !paired.has(p)),
    ...groups.map((g): Part => {
      const longest = g.reduce((a, b) => (dist(a.points[0]!, a.points[1]!) >= dist(b.points[0]!, b.points[1]!) ? a : b));
      return { kind: "parallel", strokes: g.flatMap((p) => p.strokes), points: longest.points, count: g.length, ink: g.flatMap((p) => p.ink) };
    }),
  ];
}

/**
 * The drawings among `inks` (the strokes left once pen marks are off, minus
 * `writingOnly` — a matrix's), and what is left for writing. A stroke is
 * drawing if it is big (SEED), in a dashed line, or touches a drawing and
 * is a line or a dot (a tick on a line, an angle's arc, a short line off a
 * corner); writing that touches a drawing — a label written close — keeps
 * its loops and is left alone. `marks` that join a drawing, lie inside one,
 * or join each other become parts; the rest are returned as marks.
 */
export function findDrawings(inks: Ink[], marks: PenMark[], unit: number, writingOnly: Set<string>): { drawings: DrawingDraft[]; writing: Ink[]; marks: PenMark[] } {
  const free = inks.filter((i) => !writingOnly.has(i.id));
  // A straight stroke's size is its length: a diagonal is as long as an upright, though its box is smaller.
  const reachOf = (i: Ink) => (straightish(i) ? dist(i.points[0]!, i.points[i.points.length - 1]!) : sizeOf(i.box));
  const drawn = new Set<Ink>(free.filter((i) => reachOf(i) >= SEED * unit));
  // A big loop or squiggle not much bigger than writing is a drawing's only if it touches another of its strokes: alone, it is writing written big.
  const glyphLike = (i: Ink) => sizeOf(i.box) < LONE * unit && couldBeWritten(fitStroke(i, unit));
  for (const i of [...drawn]) {
    if (glyphLike(i) && ![...drawn, ...marks.flatMap((m) => m.strokes)].some((o) => o !== i && boxGap(o.box, i.box) <= REACH * unit && inkDistance(o.points, i.points) <= REACH * unit)) drawn.delete(i);
  }
  const dashed = dashedRuns(free.filter((i) => !drawn.has(i)), unit);
  for (const run of dashed) for (const i of run) drawn.add(i);

  // Grow: what touches the drawing joins it, until nothing more does — but writing written close to it stays writing.
  const touches = (a: Ink, b: Ink) => boxGap(a.box, b.box) <= REACH * unit && inkDistance(a.points, b.points) <= REACH * unit;
  const markInk = marks.flatMap((m) => m.strokes);
  for (let grown = true; grown;) {
    grown = false;
    for (const ink of free) {
      if (drawn.has(ink)) continue;
      const anchors = [...drawn, ...markInk];
      if (!anchors.some((a) => touches(a, ink))) continue;
      const anchorAt = (p: Pt) => anchors.find((a) => boxGap(a.box, boxOf([p])) <= REACH * unit && distToPath(p, a.points) <= REACH * unit);
      // Touching other writing, it is part of a character (a stroke of an "H" written against a line). Strokes that touch the drawing themselves
      // aren't writing — its lines, or a pen mark on them; touching only a pen mark of their own, a circle round a word, they are.
      const own = [...drawn, ...marks.filter((m) => m.strokes.some((s) => [...drawn].some((d) => touches(d, s)))).flatMap((m) => m.strokes)];
      const writing = free.filter((o) => o !== ink && !drawn.has(o) && touches(o, ink) && !own.some((a) => touches(a, o)));
      const stuck = writing.length > 0;
      const [first, last] = [ink.points[0]!, ink.points[ink.points.length - 1]!];
      const size = sizeOf(ink.box);
      let joins: boolean;
      if (closedOutline(ink.points, size)) {
        // A loop joins when a line of the drawing runs through it (a wheel under a body); one merely touching is a written "O".
        const inside = anchors.flatMap((a) => a.points.slice(1).map((q, i) => [a.points[i]!, q] as const))
          .filter(([p, q]) => pointInLoop(p, ink.points) && pointInLoop(q, ink.points))
          .reduce((sum, [p, q]) => sum + dist(p, q), 0);
        joins = inside >= 0.3 * size;
      } else if (straightish(ink) || size <= DOT * unit) {
        // A tick, a short line off a corner, a dot; or a line from the drawing to a label written against its far end.
        const length = dist(first, last);
        const farEnd = anchorAt(first) ? last : anchorAt(last) ? first : null;
        const stuckOnlyThere = !!farEnd && writing.every((o) => ink.points.every((p) => dist(p, farEnd) <= 0.25 * length || distToPath(p, o.points) > REACH * unit));
        joins = !stuck || (length >= unit && stuckOnlyThere);
      } else {
        // A curve joining two lines that meet at an angle — the arc marking it, a right angle's square.
        const [a, b] = [anchorAt(first), anchorAt(last)];
        let apart = a && b ? Math.abs(directionNear(a, first) - directionNear(b, last)) : 0;
        apart = Math.min(apart, Math.PI - apart);
        joins = !stuck && dist(first, last) >= 0.5 * size && (apart * 180) / Math.PI >= 20;
      }
      if (joins) {
        drawn.add(ink);
        grown = true;
      }
    }
  }

  // Parts, grouped into drawings by nearness; marks join a group they come close to.
  type Piece = { strokes: Ink[]; mark?: PenMark };
  const runOf = new Map(dashed.flatMap((run) => run.map((i) => [i, run] as const)));
  const pieces: Piece[] = [
    ...[...drawn].filter((i) => !runOf.has(i)).map((i) => ({ strokes: [i] })),
    ...dashed.map((run) => ({ strokes: run })),
    ...marks.map((m) => ({ strokes: m.strokes, mark: m })),
  ];
  const pts = (p: Piece) => p.strokes.flatMap((s) => s.points);
  const boxOfPiece = (p: Piece) => union(p.strokes.map((s) => s.box));
  let groups = groupBy(pieces, (a, b) => boxGap(boxOfPiece(a), boxOfPiece(b)) <= GROUP_GAP * unit && inkDistance(pts(a), pts(b)) <= GROUP_GAP * unit);
  // A group mostly inside another's box is part of it (lines drawn between a graph's axes).
  const inside = (a: Box, b: Box) => {
    const overlap = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX)) * Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
    return overlap >= 0.7 * Math.max(1, width(a) * height(a));
  };
  const boxOfGroup = (g: Piece[]) => union(g.map(boxOfPiece));
  groups = groupBy(groups, (a, b) => inside(boxOfGroup(a), boxOfGroup(b)) || inside(boxOfGroup(b), boxOfGroup(a))).map((gs) => gs.flat());

  const drawings: DrawingDraft[] = [];
  const kept = new Set<Ink>();
  const usedMarks = new Set<PenMark>();
  for (const g of groups) {
    const parts = g.map((p): Part => (p.mark ? markPart(p.mark, unit)
      : p.strokes.length > 1 ? { kind: "dashed", strokes: p.strokes, points: [], count: p.strokes.length, ink: pts(p) }
      : fitStroke(p.strokes[0]!, unit)));
    // Alone, a mark stays a mark, and a loop or squiggle no bigger than writing stays writing: it may be a big "0" or "S".
    if (g.length === 1) {
      const [p] = g;
      if (p!.mark || (couldBeWritten(parts[0]!) && sizeOf(boxOfPiece(p!)) < LONE * unit)) continue;
    }
    for (const p of g) {
      p.strokes.forEach((s) => kept.add(s));
      if (p.mark) usedMarks.add(p.mark);
    }
    for (const part of parts) if (part.kind === "dashed") part.points = dashEnds(part.strokes);
    drawings.push({ parts: angleMarks(pairParallels(parts, unit), unit), strokes: g.flatMap((p) => p.strokes), box: boxOfGroup(g) });
  }
  return { drawings, writing: inks.filter((i) => !kept.has(i)), marks: marks.filter((m) => !usedMarks.has(m)) };
}

/**
 * A short line whose ends rest on two longer lines running different ways is
 * the arc marking the angle between them: drawn small, an arc is as straight
 * as a line to within the pen's tremor.
 */
function angleMarks(parts: Part[], unit: number): Part[] {
  return parts.map((p) => {
    if (p.kind !== "segment") return p;
    const chord = dist(p.points[0]!, p.points[1]!);
    const rests = p.points.map((end) => parts.filter((o) => o !== p).map((o) => ({ o, d: distToPath(end, o.ink) })).sort((x, y) => x.d - y.d)[0]);
    if (rests.some((r) => !r || r.d > 2 * REACH * unit || sizeOf(boxOf(r.o.ink)) < 2 * chord)) return p;
    const [a, b] = rests.map((r, i) => directionNear({ id: "", points: r!.o.ink, box: boxOf(r!.o.ink) }, p.points[i]!));
    let apart = Math.abs(a! - b!);
    apart = Math.min(apart, Math.PI - apart);
    if ((apart * 180) / Math.PI < ANGLE_APART) return p;
    const m = along(p.ink, 0.5);
    return { ...p, kind: "arc", points: [p.points[0]!, m, p.points[1]!], centre: circleThrough(p.points[0]!, m, p.points[1]!)?.centre };
  });
}

/** Shapes a character can have, written big: a loop ("0"), a triangle ("Δ"), a curve or a line with corners ("S", "L", "Z", "M"). */
const couldBeWritten = (p: Part) => ["circle", "triangle", "rectangle", "polygon", "arc", "curve", "polyline"].includes(p.kind);

/** A dashed line's ends: its first and last dash's centres, in order along it. */
function dashEnds(strokes: Ink[]): Pt[] {
  const cs = strokes.map((s) => ({ x: centerX(s.box), y: centerY(s.box) }));
  let [p, q] = [cs[0]!, cs[cs.length - 1]!];
  for (const a of cs) for (const b of cs) if (dist(a, b) > dist(p, q)) [p, q] = [a, b];
  return [p, q];
}

// ── joins, labels, and the graph ────────────────────────────────────────────

/** Where on a part a label sits. */
export type Place = "start" | "end" | "tail" | "head" | "middle" | "side" | "vertex" | "inside" | "near";
/**
 * Two parts (indices into `parts`) that join: `a`'s end on `b` (meet), their sides against each other (touch), or `a`, or an end of it, within `b` (inside).
 * `right`: two straight runs that meet at a right angle.
 */
export type Join = { a: number; b: number; how: "meet" | "touch" | "inside"; at?: Pt; right?: true };
/**
 * A label: written text beside the drawing, the part it is nearest, and where on that part. `index`: which side or corner (from 0, in drawing order).
 * `text`: the label as read; `shown`, as printed, if that differs — its unsure characters as what they may be, "«5|S»" (handwriting.ts's printedWord).
 */
export type DrawingLabel = { strokes: Ink[]; box: Box; text: string; shown?: string; part: number | null; place: Place; index?: number };
export type BondType = "single" | "double" | "triple" | "wedge" | "dashed";
/** Labels and unlabelled corners, joined by lines: `node`s are indices into `labels`, or `{ corner }` for an unlabelled point where lines meet. */
export type GraphNode = { label: number } | { corner: Pt };
/** `points`: where each node is — a label's middle, or the corner. */
export type Graph = { nodes: GraphNode[]; edges: { from: number; to: number; type: BondType; part: number }[]; points: Pt[] };
/**
 * Straight lines joined end to end into a closed loop: `parts` in order round it, and the `corners` between them (where
 * parts[i] and parts[i + 1] meet), or for a graph, the `nodes` (indices into its nodes) in the same order.
 */
export type Ring = { parts: number[]; corners: Pt[]; nodes?: number[] };
/** A small part (`mark`) set across a corner `at` of another (`part`), an end on each of the two sides that meet there. */
export type CornerMark = { mark: number; part: number; at: Pt };
export type Drawing = {
  parts: Part[]; strokes: Ink[]; box: Box; joins: Join[]; labels: DrawingLabel[]; graph: Graph | null; rings: Ring[]; cornerMarks: CornerMark[];
};

/** A label is short writing — at most this many words and characters — within LABEL_REACH of a drawing. */
const LABEL_WORDS = 3;
const LABEL_CHARS = 8;
const LABEL_REACH = 2;
/** A line's end this close to a label, or to another line's end, ends at it. */
const NODE_REACH = 0.9;
/** An end this close to another part meets it; sides this close touch. */
const MEET = 0.5;
const TOUCH = 0.4;
/** In choosing what a label labels, being beside a part's side counts as this many times as far as being by its end. */
const SIDE_WEIGHT = 1.5;
/** A drawing is a graph of its labels when at least this many labels sit at the ends of its lines. */
const GRAPH_LABELS = 3;

const isClosed = (p: Part) => ["circle", "triangle", "rectangle", "polygon"].includes(p.kind);
/** A part's ends, if it has any: where a line starts and stops, an arrow's tail and head, a wedge's point and wide end. */
const endsOf = (p: Part): Pt[] => (isClosed(p) || p.kind === "dot" ? [] : [p.points[0]!, p.points[p.points.length - 1]!]);
/** A closed part's outline (a circle's as a polygon). */
function outlineOf(p: Part): Pt[] {
  if (p.kind !== "circle") return p.points;
  return Array.from({ length: 24 }, (_, i) => ({ x: p.centre!.x + (p.across![0] / 2) * Math.cos((i * Math.PI) / 12), y: p.centre!.y + (p.across![1] / 2) * Math.sin((i * Math.PI) / 12) }));
}

function distToBox(p: Pt, b: Box): number {
  return Math.hypot(Math.max(b.minX - p.x, 0, p.x - b.maxX), Math.max(b.minY - p.y, 0, p.y - b.maxY));
}

/** How the parts join. */
export function joinsOf(parts: Part[], unit: number): Join[] {
  const out: Join[] = [];
  parts.forEach((a, i) => parts.forEach((b, j) => {
    if (j <= i) return;
    const meetAt = [...endsOf(a).map((e) => ({ e, other: b })), ...endsOf(b).map((e) => ({ e, other: a }))]
      .find(({ e, other }) => distToPath(e, other.ink) <= MEET * unit);
    if (meetAt) {
      // Recorded as the one whose end it is first.
      const [x, y] = meetAt.other === b ? [i, j] : [j, i];
      const [u, v] = [runAt(a, meetAt.e), runAt(b, meetAt.e)];
      let apart = u === null || v === null ? 0 : Math.abs(u - v);
      apart = Math.min(apart, Math.PI - apart);
      out.push({ a: x, b: y, how: "meet", at: meetAt.e, ...(Math.abs((apart * 180) / Math.PI - 90) <= RIGHT ? { right: true as const } : {}) });
      return;
    }
    const inside = [[a, b, i, j], [b, a, j, i]].map(([p, q, x, y]) => {
      const pp = p as Part;
      const qq = q as Part;
      if (!isClosed(qq)) return null;
      const end = endsOf(pp).find((e) => pointInLoop(e, outlineOf(qq)));
      const most = pp.ink.filter((pt) => pointInLoop(pt, outlineOf(qq))).length >= 0.7 * pp.ink.length;
      return end || most ? { a: x as number, b: y as number, how: "inside" as const, ...(end ? { at: end } : {}) } : null;
    }).find((x) => x);
    if (inside) {
      out.push(inside);
      return;
    }
    if (boxGap(boxOf(a.ink), boxOf(b.ink)) <= TOUCH * unit) {
      const near = a.ink.map((p) => ({ p, d: distToPath(p, b.ink) })).sort((x, y) => x.d - y.d)[0]!;
      if (near.d <= TOUCH * unit) out.push({ a: i, b: j, how: "touch", at: near.p });
    }
  }));
  return out;
}

/**
 * The direction (radians, 0–π) of the straight run of `p` at `q`: a line's
 * (an arrow's shaft, parallel lines', a row of strokes'), or the leg of a
 * line with corners or the side of a closed shape nearest `q`. Null for a
 * part with no straight run: round, curved, zigzag, a dot.
 */
function runAt(p: Part, q: Pt): number | null {
  const direction = (a: Pt, b: Pt) => (Math.atan2(b.y - a.y, b.x - a.x) + Math.PI) % Math.PI;
  const [first, last] = [p.points[0]!, p.points[p.points.length - 1]!];
  switch (p.kind) {
    case "segment": case "arrow": case "parallel": case "dashed": case "wedge": return direction(first, last);
    case "polyline": case "triangle": case "rectangle": case "polygon": {
      const legs = p.points.slice(p.kind === "polyline" ? 1 : 0).map((b, k) => {
        const a = p.kind === "polyline" ? p.points[k]! : p.points[(k - 1 + p.points.length) % p.points.length]!;
        return [a, b] as const;
      });
      const [a, b] = legs.reduce((best, leg) => (distToSegment(q, ...leg) < distToSegment(q, ...best) ? leg : best));
      return direction(a, b);
    }
    default: return null;
  }
}

/** A part's corners with the two sides that meet at each: a closed shape's every corner, a line with corners' inner ones. */
function cornersOf(p: Part): { at: Pt; sides: [Pt, Pt] }[] {
  const n = p.points.length;
  if (["triangle", "rectangle", "polygon"].includes(p.kind)) return p.points.map((v, i) => ({ at: v, sides: [p.points[(i - 1 + n) % n]!, p.points[(i + 1) % n]!] }));
  if (p.kind === "polyline") return p.points.slice(1, -1).map((v, k) => ({ at: v, sides: [p.points[k]!, p.points[k + 2]!] }));
  return [];
}

/**
 * Small parts set across another's corner, an end on each of the two sides
 * that meet there and no further along them than half their length: the arc
 * marking an angle, the square marking a right angle. Only a short line, an
 * arc, or a line with one corner can be one.
 */
function cornerMarksOf(parts: Part[], unit: number): CornerMark[] {
  const out: CornerMark[] = [];
  parts.forEach((m, i) => {
    if (!(m.kind === "arc" || m.kind === "segment" || (m.kind === "polyline" && m.count === 1))) return;
    const [e1, e2] = [m.points[0]!, m.points[m.points.length - 1]!];
    parts.forEach((p, j) => {
      if (j === i) return;
      for (const { at, sides: [s1, s2] } of cornersOf(p)) {
        const on = (e: Pt, side: Pt) => distToSegment(e, at, side) <= MEET * unit && dist(e, at) >= MEET * unit && dist(e, at) <= 0.5 * dist(at, side);
        if ((on(e1, s1) && on(e2, s2)) || (on(e1, s2) && on(e2, s1))) out.push({ mark: i, part: j, at });
      }
    });
  });
  return out;
}

/**
 * Closed rings in a graph of `edges` between numbered nodes: for each edge,
 * the shortest way round back to it through the others, if there is one —
 * so two rings sharing a side are two rings, not one big one. Each ring once,
 * its edges and nodes in order round it.
 */
function cyclesOf(edges: { from: number; to: number }[]): { edges: number[]; nodes: number[] }[] {
  const out: { edges: number[]; nodes: number[] }[] = [];
  const seen = new Set<string>();
  edges.forEach((e, k) => {
    // Breadth first from e.from to e.to, without e.
    const back = new Map<number, { node: number; edge: number }>([[e.from, { node: -1, edge: -1 }]]);
    for (let frontier = [e.from]; frontier.length && !back.has(e.to);) {
      const next: number[] = [];
      for (const n of frontier) {
        edges.forEach((f, m) => {
          if (m === k || (f.from !== n && f.to !== n)) return;
          const other = f.from === n ? f.to : f.from;
          if (back.has(other)) return;
          back.set(other, { node: n, edge: m });
          next.push(other);
        });
      }
      frontier = next;
    }
    if (!back.has(e.to)) return;
    const nodes = [e.to];
    const ring = [k];
    for (let n = e.to; n !== e.from; n = back.get(n)!.node) {
      ring.push(back.get(n)!.edge);
      nodes.push(back.get(n)!.node);
    }
    const key = [...ring].sort((x, y) => x - y).join(",");
    if (ring.length < 3 || seen.has(key)) return;
    seen.add(key);
    out.push({ edges: ring, nodes });
  });
  return out;
}

/** How many straight sides a part makes in a ring: a line one, a line with corners one more than its corners. */
export const sidesOf = (p: Part) => (p.kind === "polyline" ? p.count! + 1 : 1);

/**
 * Straight lines (single lines, lines with corners) joined end to end into
 * closed rings: their ends, where within MEET of each other, are the ring's
 * corners. For a graph, its rings of labels and corners instead.
 */
function ringsOf(parts: Part[], graph: Graph | null, unit: number): Ring[] {
  if (graph) {
    const nodePoint = (n: number) => graph.points[n]!;
    return cyclesOf(graph.edges).map((c) => ({ parts: c.edges.map((k) => graph.edges[k]!.part), corners: c.nodes.map(nodePoint), nodes: c.nodes }));
  }
  const lines = parts.map((p, i) => ({ p, i })).filter(({ p }) => p.kind === "segment" || p.kind === "polyline");
  const ends = lines.flatMap(({ p, i }) => [{ e: p.points[0]!, i }, { e: p.points[p.points.length - 1]!, i }]);
  const clusters = groupBy(ends, (a, b) => dist(a.e, b.e) <= MEET * unit);
  const clusterOf = (x: (typeof ends)[number]) => clusters.findIndex((c) => c.includes(x));
  const edges = lines.map(({ i }) => {
    const [a, b] = ends.filter((x) => x.i === i);
    return { from: clusterOf(a!), to: clusterOf(b!), part: i };
  }).filter((e) => e.from !== e.to);
  const centre = (c: (typeof ends)[number][]) => ({ x: c.reduce((s, x) => s + x.e.x, 0) / c.length, y: c.reduce((s, x) => s + x.e.y, 0) / c.length });
  return cyclesOf(edges).map((c) => ({ parts: c.edges.map((k) => edges[k]!.part), corners: c.nodes.map((n) => centre(clusters[n]!)) }));
}

/** Where on `part` a label centred at `c` sits. */
function placeOn(part: Part, c: Pt, unit: number): { place: Place; index?: number } {
  if (part.kind === "dot") return { place: "near" };
  if (part.kind === "arrow") {
    const [tail, head] = part.points as [Pt, Pt];
    const options: [Place, number][] = [["tail", dist(c, tail)], ["head", dist(c, head)], ["middle", dist(c, mid(tail, head))]];
    return { place: options.sort((a, b) => a[1] - b[1])[0]![0] };
  }
  if (isClosed(part)) {
    const outline = outlineOf(part);
    if (pointInLoop(c, outline)) return { place: "inside" };
    if (part.kind === "circle") return { place: "near" };
    const corners = part.points;
    const vertex = corners.findIndex((v) => dist(c, v) <= 1.2 * unit);
    if (vertex >= 0) return { place: "vertex", index: vertex };
    const sides = corners.map((v, k) => distToSegment(c, v, corners[(k + 1) % corners.length]!));
    return { place: "side", index: sides.indexOf(Math.min(...sides)) };
  }
  // Lines: by where along the line its nearest point is.
  const path = ["segment", "parallel", "wedge", "dashed"].includes(part.kind) ? part.points : part.ink;
  let best = { d: Infinity, t: 0 };
  const total = pathLength(path);
  let walked = 0;
  for (let k = 1; k < path.length; k++) {
    const [a, b] = [path[k - 1]!, path[k]!];
    const len = dist(a, b);
    const u = len === 0 ? 0 : Math.max(0, Math.min(1, ((c.x - a.x) * (b.x - a.x) + (c.y - a.y) * (b.y - a.y)) / len ** 2));
    const d = dist(c, { x: a.x + u * (b.x - a.x), y: a.y + u * (b.y - a.y) });
    if (d < best.d) best = { d, t: total ? (walked + u * len) / total : 0 };
    walked += len;
  }
  return { place: best.t < 0.2 ? "start" : best.t > 0.8 ? "end" : "middle" };
}

/**
 * Which part a label belongs to. People write a label by a line's end (an
 * arrow's head, where a line stops) more than beside its run, so a part's
 * side counts as SIDE_WEIGHT times as far as its end; and a label inside a
 * closed shape labels something near it in there before the shape itself
 * (the "θ" between a slope and its base, by the arc marking the angle).
 */
function labelledPart(parts: Part[], box: Box, c: Pt, unit: number): { i: number } | undefined {
  const scored = parts.map((p, i) => {
    // An arrow's side is its shaft: the barbs of its head reach back past its tip.
    const along = p.kind === "arrow" ? Array.from({ length: 25 }, (_, k) => ({ x: p.points[0]!.x + ((p.points[1]!.x - p.points[0]!.x) * k) / 24, y: p.points[0]!.y + ((p.points[1]!.y - p.points[0]!.y) * k) / 24 })) : p.ink;
    const side = Math.min(...along.map((q) => distToBox(q, box)));
    const end = Math.min(Infinity, ...endsOf(p).map((e) => distToBox(e, box)));
    return { i, r: Math.min(end, SIDE_WEIGHT * side), around: isClosed(p) && pointInLoop(c, outlineOf(p)) };
  }).sort((x, y) => x.r - y.r);
  return scored.find((x) => !x.around && x.r <= LABEL_REACH * unit) ?? scored[0];
}

/** The graph: lines (single, parallel, wedge, dashed) between labels, or unlabelled corners where lines meet. */
function graphOf(parts: Part[], labels: DrawingLabel[], unit: number): Graph | null {
  const bonds = parts.map((p, i) => ({ p, i })).filter(({ p }) => ["segment", "parallel", "wedge", "dashed"].includes(p.kind));
  const ends = bonds.flatMap(({ p, i }) => p.points.slice(0, 2).map((e, k) => ({ e, part: i, k })));
  // Each end: the nearest label it reaches, or else a corner shared with the other ends near it.
  const labelOf = (e: Pt) => {
    const near = labels.map((l, n) => ({ n, d: distToBox(e, l.box) })).filter((x) => x.d <= NODE_REACH * unit).sort((a, b) => a.d - b.d)[0];
    return near?.n;
  };
  const free = ends.filter((x) => labelOf(x.e) === undefined);
  const clusters = groupBy(free, (a, b) => dist(a.e, b.e) <= NODE_REACH * unit);
  const nodes: GraphNode[] = [...labels.map((_, n) => ({ label: n })), ...clusters.map((c) => ({ corner: { x: c.reduce((s, x) => s + x.e.x, 0) / c.length, y: c.reduce((s, x) => s + x.e.y, 0) / c.length } }))];
  const nodeOf = (x: (typeof ends)[number]) => labelOf(x.e) ?? labels.length + clusters.findIndex((c) => c.includes(x));
  const typeOf = (p: Part): BondType => (p.kind === "parallel" ? (p.count === 3 ? "triple" : "double") : p.kind === "segment" ? "single" : (p.kind as BondType));
  const edges = bonds.map(({ p, i }) => {
    const [a, b] = ends.filter((x) => x.part === i);
    return { from: nodeOf(a!), to: nodeOf(b!), type: typeOf(p), part: i };
  }).filter((e) => e.from !== e.to);
  const labelled = new Set(edges.flatMap((e) => [e.from, e.to]).filter((n) => n < labels.length));
  const points = nodes.map((n) => ("label" in n ? { x: centerX(labels[n.label]!.box), y: centerY(labels[n.label]!.box) } : n.corner));
  return labelled.size >= GRAPH_LABELS ? { nodes, edges, points } : null;
}

/**
 * Labels for the drawings: short writing near them, each run of close words
 * one label (a line holding "O" and, far along it, "H" is two; so is a line
 * running on through the labels of two drawings side by side). A label
 * within reach of the ends of two drawings' lines joins them into one (the
 * "C" between a molecule's bonds). `blocks` are the board's lines of writing,
 * `textOf` reads words (`shown`: as printed, where the recognizer is unsure
 * of some of it). Returns the finished drawings and the blocks they took as
 * labels — only blocks all of whose words became labels.
 */
export function attachLabels(
  drafts: DrawingDraft[], blocks: TextBlock[], textOf: (words: Word[]) => { text: string; shown?: string }, unit: number,
): { drawings: Drawing[]; labels: Set<TextBlock> } {
  type Run = { block: TextBlock; words: Word[]; box: Box };
  const all = blocks.flatMap((b) => {
      // Close: no further apart than its characters are tall (the block can be taller, holding labels at different heights).
      const tall = b.words.flatMap((w) => w.glyphs.map((g) => height(g.box))).sort((x, y) => x - y);
      const size = tall[Math.floor(tall.length / 2)]!;
      const out: Run[] = [];
      for (const w of b.words) {
        const last = out[out.length - 1];
        if (last && w.box.minX - last.box.maxX <= size) {
          last.words.push(w);
          last.box = union([last.box, w.box]);
        } else out.push({ block: b, words: [w], box: w.box });
      }
      return out;
    });
  const runs = all.filter((r) => r.words.length <= LABEL_WORDS && r.words.reduce((n, w) => n + w.glyphs.length, 0) <= LABEL_CHARS);
  const reach = (r: Run, d: DrawingDraft) => Math.min(...d.parts.flatMap((p) => p.ink).map((p) => distToBox(p, r.box)));
  const atEnds = (r: Run, d: DrawingDraft) => d.parts.some((p) => endsOf(p).some((e) => distToBox(e, r.box) <= NODE_REACH * unit));
  // Join drawings through a label at both's ends.
  let groups = drafts.map((d) => [d]);
  for (const r of runs) {
    const touching = groups.filter((g) => g.some((d) => atEnds(r, d)));
    if (touching.length >= 2) groups = [...groups.filter((g) => !touching.includes(g)), touching.flat()];
  }
  const merged: DrawingDraft[] = groups.map((g) => (g.length === 1 ? g[0]! : { parts: g.flatMap((d) => d.parts), strokes: g.flatMap((d) => d.strokes), box: union(g.map((d) => d.box)) }));

  const owned = new Map<DrawingDraft, Run[]>();
  const placed = new Set<Run>();
  for (const r of runs) {
    const near = merged.map((d) => ({ d, r: reach(r, d) })).filter((x) => x.r <= LABEL_REACH * unit).sort((x, y) => x.r - y.r)[0];
    if (!near) continue;
    placed.add(r);
    owned.set(near.d, [...(owned.get(near.d) ?? []), r]);
  }
  // A line of writing is a drawing's only if all of it is: otherwise none of it is, and it stays writing.
  const taken = new Set(runs.filter((r) => placed.has(r)).map((r) => r.block).filter((b) => all.filter((r) => r.block === b).every((r) => placed.has(r))));
  const drawings = merged.map((d): Drawing => {
    const labels = (owned.get(d) ?? []).filter((r) => taken.has(r.block)).map((r): DrawingLabel => {
      const c = { x: centerX(r.box), y: centerY(r.box) };
      const nearest = labelledPart(d.parts, r.box, c, unit);
      const strokes = r.words.flatMap((w) => w.glyphs.flatMap((g) => g.strokes));
      return { strokes, box: r.box, ...textOf(r.words), part: nearest?.i ?? null, ...(nearest ? placeOn(d.parts[nearest.i]!, c, unit) : { place: "near" as const }) };
    });
    const graph = graphOf(d.parts, labels, unit);
    return {
      ...d, strokes: [...d.strokes, ...labels.flatMap((l) => l.strokes)], box: union([d.box, ...labels.map((l) => l.box)]),
      joins: joinsOf(d.parts, unit), labels, graph, rings: ringsOf(d.parts, graph, unit), cornerMarks: cornerMarksOf(d.parts, unit),
    };
  });
  return { drawings, labels: taken };
}
