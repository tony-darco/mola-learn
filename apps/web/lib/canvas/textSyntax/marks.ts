/**
 * Finds the marks people draw with the pen *about* their writing rather than
 * as part of it — circles around things, arrows between them, lines under
 * them — so that segmentation (segment.ts) never sees them: a long stroke
 * would glue together every character it crosses, and a big loop would come
 * out as an oversized line of "text".
 *
 * Geometry only, in the spirit of the bracket and bar detection there, and
 * every threshold is a multiple of the typical stroke size (`unit`, see
 * strokeUnit).
 */
import { centerX, centerY, height, union, width, type Box, type Ink, type Pt } from "./segment";

export type PenMark =
  /** A closed loop around something; `outline` is the stroke itself, closed implicitly. */
  | { kind: "circle"; strokes: Ink[]; box: Box; outline: Pt[] }
  /** `tail` is where the shaft starts, `tip` where the head is. */
  | { kind: "arrow"; strokes: Ink[]; box: Box; tail: Pt; tip: Pt }
  | { kind: "underline"; strokes: Ink[]; box: Box };

/** A loop is at least this × the unit across — a written "0" is about 1. */
const LOOP_SIZE = 1.5;
/** Its ends are no further apart than this × its size… */
const LOOP_GAP = 0.3;
/** …and it encloses at least this fraction of its box (an ellipse fills 0.79; a doubled-back line, nothing). */
const LOOP_FILL = 0.3;
/** An arrow's shaft runs at least this × the unit from end to end, like a bracket (segment.ts's TALL_RATIO). The "↓" in a row-operation label is about 1. */
const SHAFT = 2.5;
/** A separately drawn head is a V no bigger than this × the unit… */
const HEAD_SIZE = 1.5;
/** …whose point is within this × the unit of the shaft's end… */
const HEAD_REACH = 0.5;
/** …and opens back along the shaft, its bisector within this many degrees of it. */
const HEAD_ALIGN = 35;
/** A head drawn on in the same stroke turns back from the shaft by more than this many degrees… */
const REVERSAL = 110;
/** …and is at most this × the unit of ink (both barbs and the retrace between them), with a barb reaching this × the unit out to each side. */
const HEAD_PATH = 3;
const BARB_SPREAD = 0.15;
/** The tip is within this × the unit of the stroke's furthest reach from its tail. */
const TIP_SLACK = 0.3;
/** An underline is at least this × the unit wide, rises less than this per unit of run, and sits within this × the unit under what it underlines. */
const UNDERLINE_WIDTH = 1.5;
const NEAR_FLAT = 0.25;
const UNDERLINE_GAP = 0.75;
/** A stroke is straight when no point strays from the line between its ends by more than this × that line's length (recognize.ts's STRAIGHT). */
const STRAIGHT = 0.25;

// ── geometry ────────────────────────────────────────────────────────────────

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const len = (v: Pt) => Math.hypot(v.x, v.y);
const dist = (a: Pt, b: Pt) => len(sub(a, b));
const normal = (v: Pt): Pt => (len(v) === 0 ? { x: 0, y: 0 } : { x: v.x / len(v), y: v.y / len(v) });
const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;
const degrees = (a: Pt, b: Pt) => (Math.acos(Math.max(-1, Math.min(1, dot(normal(a), normal(b))))) * 180) / Math.PI;
export const boxCenter = (b: Box): Pt => ({ x: centerX(b), y: centerY(b) });

const pathLength = (points: Pt[]) => points.reduce((s, p, i) => (i ? s + dist(p, points[i - 1]!) : 0), 0);

/** The point `d` along the path from its start (its last point if the path is shorter). */
function walk(points: Pt[], d: number): Pt {
  let left = d;
  for (let i = 1; i < points.length; i++) {
    const step = dist(points[i]!, points[i - 1]!);
    if (step >= left) return { x: points[i - 1]!.x + ((points[i]!.x - points[i - 1]!.x) * left) / step, y: points[i - 1]!.y + ((points[i]!.y - points[i - 1]!.y) * left) / step };
    left -= step;
  }
  return points[points.length - 1]!;
}

function straight(points: Pt[]): boolean {
  const a = points[0]!;
  const b = points[points.length - 1]!;
  const chord = dist(a, b);
  return chord > 0 && points.every((p) => Math.abs(cross(sub(b, a), sub(p, a))) / chord <= STRAIGHT * chord);
}

export function pointInPolygon(p: Pt, polygon: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

const polygonArea = (points: Pt[]) => Math.abs(points.reduce((s, p, i) => s + cross(p, points[(i + 1) % points.length]!), 0)) / 2;

// ── shapes of strokes ───────────────────────────────────────────────────────

/** The stroke as a closed outline, if it is a big loop: its ends nearly meet and it encloses real area. */
function loop(ink: Ink, unit: number): Pt[] | null {
  const size = Math.max(width(ink.box), height(ink.box));
  if (size < LOOP_SIZE * unit) return null;
  if (dist(ink.points[0]!, ink.points[ink.points.length - 1]!) > LOOP_GAP * size) return null;
  return polygonArea(ink.points) >= LOOP_FILL * width(ink.box) * height(ink.box) ? ink.points : null;
}

type Vee = { apex: Pt; arms: [Pt, Pt]; bisector: Pt };

/** A small stroke made of two straight arms meeting at a point — a separately drawn arrowhead. */
function vee(ink: Ink, unit: number): Vee | null {
  if (Math.max(width(ink.box), height(ink.box)) > HEAD_SIZE * unit) return null;
  const pts = ink.points;
  const a = pts[0]!;
  const b = pts[pts.length - 1]!;
  // The point: the one furthest from both ends.
  let k = 0;
  pts.forEach((p, i) => { if (Math.min(dist(p, a), dist(p, b)) > Math.min(dist(pts[k]!, a), dist(pts[k]!, b))) k = i; });
  const apex = pts[k]!;
  const arms: [Pt, Pt] = [sub(a, apex), sub(b, apex)];
  const [la, lb] = arms.map(len) as [number, number];
  if (Math.min(la, lb) < 0.2 * unit || Math.max(la, lb) > 2.5 * Math.min(la, lb)) return null;
  if (!straight(pts.slice(0, k + 1)) || !straight(pts.slice(k))) return null;
  const opening = degrees(arms[0], arms[1]);
  if (opening < 25 || opening > 130) return null;
  return { apex, arms, bisector: normal({ x: normal(arms[0]).x + normal(arms[1]).x, y: normal(arms[0]).y + normal(arms[1]).y }) };
}

/**
 * An arrow in one stroke: a long shaft, then a sharp turn back at its far
 * end into a short head with a barb to each side. The tip is where the
 * stroke first turns back once about as far from where it started as it
 * ever gets (the barbs come back toward the tail; the pen often returns to
 * the tip for the second barb a touch further out). Tried from both ends,
 * for an arrow drawn head first.
 */
function arrowInOneStroke(points: Pt[], unit: number): { tail: Pt; tip: Pt } | null {
  for (const pts of [points, [...points].reverse()]) {
    const tail = pts[0]!;
    const out = pts.map((p) => dist(p, tail));
    const furthest = Math.max(...out);
    const t = out.findIndex((d, i) => d >= furthest - TIP_SLACK * unit && (i === out.length - 1 || out[i + 1]! < d));
    const tip = pts[t]!;
    const shaft = pts.slice(0, t + 1);
    const head = pts.slice(t);
    if (head.length < 2 || dist(tail, tip) < SHAFT * unit) continue;
    const headLength = pathLength(head);
    if (headLength < 0.3 * unit || headLength > Math.min(HEAD_PATH * unit, 0.5 * pathLength(shaft))) continue;
    const arriving = sub(tip, walk([...shaft].reverse(), 0.5 * unit));
    const leaving = sub(walk(head, 0.4 * unit), tip);
    if (degrees(arriving, leaving) < REVERSAL) continue;
    // A barb out to each side of the shaft. A bracket's arm, which under a
    // quick hand can overshoot its corner and turn back almost as sharply,
    // only ever goes to one side; a stroke that doubles back over itself, to neither.
    const sides = head.map((p) => cross(normal(arriving), sub(p, tip)));
    if (Math.max(...sides) < BARB_SPREAD * unit || Math.min(...sides) > -BARB_SPREAD * unit) continue;
    return { tail, tip };
  }
  return null;
}

/** A long stroke with a separately drawn V at one end, opening back along it. */
function arrowWithHead(ink: Ink, heads: { ink: Ink; vee: Vee }[], unit: number): { head: Ink; tail: Pt; tip: Pt } | null {
  const pts = ink.points;
  if (dist(pts[0]!, pts[pts.length - 1]!) < SHAFT * unit) return null;
  let best: { head: Ink; tail: Pt; tip: Pt; reach: number } | null = null;
  for (const path of [pts, [...pts].reverse()]) {
    const tip = path[path.length - 1]!;
    const back = sub(walk([...path].reverse(), 0.75 * unit), tip);
    for (const { ink: head, vee: v } of heads) {
      const reach = dist(v.apex, tip);
      if (reach > HEAD_REACH * unit || degrees(v.bisector, back) > HEAD_ALIGN) continue;
      // One barb on each side of the shaft.
      if (cross(back, v.arms[0]) * cross(back, v.arms[1]) >= 0) continue;
      if (!best || reach < best.reach) best = { head, tail: path[0]!, tip, reach };
    }
  }
  return best && { head: best.head, tail: best.tail, tip: best.tip };
}

function flatAndStraight(ink: Ink): boolean {
  const a = ink.points[0]!;
  const b = ink.points[ink.points.length - 1]!;
  return Math.abs(b.y - a.y) <= NEAR_FLAT * Math.abs(b.x - a.x) && straight(ink.points);
}

// ── detection ───────────────────────────────────────────────────────────────

/**
 * Pen marks among `inks`, and the strokes left over for segmentation.
 * `placed` are the boxes of typed and placed content (text boxes, notes, …),
 * which a mark can be drawn around or under just like handwriting.
 *
 * Circles first — a big loop only counts if something is inside it, which is
 * what keeps a "0" a digit — then arrows, then underlines.
 */
export function detectPenMarks(inks: Ink[], unit: number, placed: Box[] = []): { marks: PenMark[]; rest: Ink[] } {
  const marks: PenMark[] = [];
  const used = new Set<string>();
  const take = (mark: PenMark) => {
    marks.push(mark);
    mark.strokes.forEach((s) => used.add(s.id));
  };

  for (const ink of inks) {
    const outline = loop(ink, unit);
    if (!outline) continue;
    const inside = (b: Box) => pointInPolygon(boxCenter(b), outline);
    if (inks.some((o) => o !== ink && inside(o.box)) || placed.some(inside)) take({ kind: "circle", strokes: [ink], box: ink.box, outline });
  }

  const heads = inks.flatMap((ink) => {
    const v = used.has(ink.id) ? null : vee(ink, unit);
    return v ? [{ ink, vee: v }] : [];
  });
  for (const ink of inks) {
    if (used.has(ink.id)) continue;
    const joined = arrowInOneStroke(ink.points, unit);
    if (joined) {
      take({ kind: "arrow", strokes: [ink], box: ink.box, ...joined });
      continue;
    }
    const withHead = arrowWithHead(ink, heads.filter((h) => h.ink !== ink && !used.has(h.ink.id)), unit);
    if (withHead) take({ kind: "arrow", strokes: [ink, withHead.head], box: union([ink.box, withHead.head.box]), tail: withHead.tail, tip: withHead.tip });
  }

  for (const ink of inks) {
    if (used.has(ink.id) || width(ink.box) < UNDERLINE_WIDTH * unit || !flatAndStraight(ink)) continue;
    const y = centerY(ink.box);
    const over = (b: Box) => centerX(b) >= ink.box.minX && centerX(b) <= ink.box.maxX && b.maxY <= y && y - b.maxY <= UNDERLINE_GAP * unit;
    if (inks.some((o) => o !== ink && !used.has(o.id) && over(o.box)) || placed.some(over)) take({ kind: "underline", strokes: [ink], box: ink.box });
  }

  return { marks, rest: inks.filter((i) => !used.has(i.id)) };
}
