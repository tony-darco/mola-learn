/**
 * The "diagram board": eight hand-drawn diagrams — CO₂, CH₄, a glucose ring,
 * a car with its speed worked out, a ball on an incline, a simple circuit, a
 * supply-and-demand graph, a right triangle — each drawn twice, neat and
 * shaky. One section per diagram × style, in a grid: each row holds two
 * diagrams, each neat then shaky.
 *
 * Pure and deterministic, like readerBoard.ts: the same plan comes out every
 * time. canvas-diagram-board.spec.ts draws it into a saved canvas once,
 * through the Pen tool. Each section's `truth` (diagramTruth.ts) records what
 * was drawn by its indices into `strokes`, so the sketch layer can be checked
 * stroke by stroke. Nothing on the board says what a drawing is.
 */
import { arrowStrokes, penStroke, seededRandom, writeText, type Jitter, type Pt, type Stroke } from "./strokeFont";
import type {
  DiagramName, DiagramSection, DiagramStyle, DiagramTruth, PrimitiveKind, RightAngle, TruthConnection, TruthGraph, TruthLabel, TruthPrimitive,
} from "./diagramTruth";
import type { Rect } from "./readerBoard";

/** Title of Alice's saved diagram canvas — how later tests find it. */
export const DIAGRAM_BOARD_TITLE = "E2E Diagram Board";

export type DiagramBoardPlan = {
  sections: DiagramSection[];
  /** Pen strokes for every section, in draw order — what the truth's stroke indices point into. */
  strokes: Stroke[];
  bounds: Rect;
};

const SECTION_W = 520;
const SECTION_H = 280;
const COLUMN_PITCH = 550;
const ROW_PITCH = 300;
// Clear of the pen's style panel (the canvas's top left) and the zoom controls (its bottom left): a stroke started on either is a click on it.
const ORIGIN = { x: 240, y: 100 };
const LABEL = 22; // cap height of labels and worked formulas
const DIAGRAMS: DiagramName[] = ["co2", "ch4", "glucose", "car", "incline", "circuit", "supply-demand", "right-triangle"];
const STYLES: DiagramStyle[] = ["neat", "shaky"];

const DEPICTS: Record<DiagramName, string> = {
  co2: "Carbon dioxide (CO₂): a linear O=C=O molecule, two double bonds.",
  ch4: "Methane (CH₄) in 3D: a tetrahedral carbon with two bonds in the plane, one wedge bond toward the viewer and one dashed bond away from it.",
  glucose: "A glucose ring (α-D-glucopyranose) as a simplified Haworth projection: a six-membered ring with the ring O, CH₂OH on C5, and OH / H on C1–C4.",
  car: "A car moving right at velocity v over a 100 m distance, with its speed worked out: v = d/t = 100/5 = 20 m/s.",
  incline: "A ball on an inclined plane at angle θ: its weight mg straight down, the normal force N perpendicular to the slope, and a = g sin θ.",
  circuit: "A simple series circuit: a 9 V battery and one resistor R in a single loop of wire.",
  "supply-demand": "A supply-and-demand graph: price P against quantity Q, a downward demand line D and an upward supply line S, crossing at the equilibrium (dot).",
  "right-triangle": "A right triangle with legs a and b and hypotenuse c, the right angle marked with a small square (Pythagoras: a² + b² = c²).",
};

type XY = [number, number];

/** One section being drawn: the hand drawing it, where it sits, and what it has drawn so far. */
type Sheet = {
  /** The hand, for writing. */
  j: Jitter;
  /** The same hand for line work: a smaller tremor, since one that suits a letter turns a long line into a wave. */
  trace: Jitter;
  /** How far a line's corners and ends land from where they were aimed, ± px. */
  aim: number;
  /** How far a long straight run bows off true (± px), and how far it S-bends. */
  bow: number;
  bend: number;
  /** Circles: how far the pen runs past a full turn (degrees), and how far from round (± fraction). */
  overshoot: number;
  oval: number;
  head: "separate" | "joined";
  /** No jitter at all: lines, circles, arrows and writing exactly as aimed. */
  clean: boolean;
  origin: Pt;
  /** The whole plan's strokes. */
  strokes: Stroke[];
  truth: DiagramTruth;
};

/** Neat writes like readerBoard's neat hand, shaky like its shaky one; a clean hand has no jitter at all. */
function hand(style: DiagramStyle, seed: number, clean: boolean): Omit<Sheet, "origin" | "strokes" | "truth"> {
  const rng = seededRandom(seed);
  if (clean) {
    const still: Jitter = { rng, slantDeg: 0, scale: 0, offset: 0, strokeOffset: 0, wobble: 0 };
    return { j: still, trace: still, aim: 0, bow: 0, bend: 0, overshoot: 0, oval: 0, head: style === "neat" ? "separate" : "joined", clean };
  }
  return style === "neat"
    ? {
      j: { rng, slantDeg: 5, scale: 0.05, offset: 1.2, strokeOffset: 0.6, wobble: 0.6 },
      trace: { rng, slantDeg: 0, scale: 0, offset: 0, strokeOffset: 0, wobble: 0.35 },
      aim: 1.5, bow: 1.5, bend: 0, overshoot: 8, oval: 0.03, head: "separate", clean,
    }
    : {
      j: { rng, slantDeg: 14, scale: 0.15, offset: 3, strokeOffset: 1.8, wobble: 2.2 },
      trace: { rng, slantDeg: 0, scale: 0, offset: 0, strokeOffset: 0, wobble: 1 },
      aim: 4, bow: 4, bend: 2, overshoot: 25, oval: 0.08, head: "joined", clean,
    };
}

// ── drawing ──────────────────────────────────────────────────────────────────

const spread = (s: Sheet, amount: number) => (s.j.rng() * 2 - 1) * amount;
/** Section-local (x, y) to board coordinates. */
const at = (s: Sheet, x: number, y: number): Pt => ({ x: s.origin.x + x, y: s.origin.y + y });
/** The same hand with less tremor, for short marks a full tremor would scribble over. */
const steady = (s: Sheet): Jitter => ({ ...s.j, wobble: s.j.wobble * 0.3 });
const closed = (points: XY[]): XY[] => [...points, points[0]!];
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Adds strokes to the plan; their indices. */
function put(s: Sheet, strokes: Stroke[]): number[] {
  return strokes.map((stroke) => s.strokes.push(stroke) - 1);
}

/** Draws a primitive and records it in the truth; its id. */
function shape(s: Sheet, id: string, kind: PrimitiveKind, strokes: Stroke[], extra: Partial<TruthPrimitive> = {}): string {
  s.truth.primitives.push({ id, kind, strokes: put(s, strokes), ...extra });
  return id;
}

/** `right`: for two straight lines that meet, whether they were drawn at a right angle (see rightAngle). */
function connect(s: Sheet, a: string, b: string, how: TruthConnection["how"], right?: RightAngle) {
  (s.truth.connections ??= []).push({ a, b, how, ...(right !== undefined ? { right } : {}) });
}

/** An angle in degrees as the truth records it: within 1° of a right angle is one, more than 15° off clearly isn't, and between is left unchecked. */
const rightAngle = (deg: number): RightAngle => (Math.abs(deg - 90) <= 1 ? true : Math.abs(deg - 90) > 15 ? false : null);

/** The angle (0–180°) at `v` between the directions to `a` and to `b`. */
function angleAt(v: XY, a: XY, b: XY): number {
  const [ux, uy, wx, wy] = [a[0] - v[0], a[1] - v[1], b[0] - v[0], b[1] - v[1]];
  return (Math.acos(Math.max(-1, Math.min(1, (ux * wx + uy * wy) / (Math.hypot(ux, uy) * Math.hypot(wx, wy))))) * 180) / Math.PI;
}

/** Whether the line through `a1` and `a2` and the one through `b1` and `b2` cross at a right angle (rightAngle). */
function linesRight(a1: XY, a2: XY, b1: XY, b2: XY): RightAngle {
  const deg = angleAt([0, 0], [a2[0] - a1[0], a2[1] - a1[1]], [b2[0] - b1[0], b2[1] - b1[1]]);
  return rightAngle(Math.min(deg, 180 - deg));
}

/** A path's corners as aimed, for the truth (board coordinates): a closed one's every point, an open one's inner ones; each with its angle. */
function cornersOf(s: Sheet, points: XY[], isClosed: boolean): NonNullable<TruthPrimitive["corners"]> {
  const n = points.length;
  const inner = isClosed ? points.map((_, i) => i) : points.slice(1, -1).map((_, i) => i + 1);
  return inner.map((i) => {
    const v = points[i]!;
    return { ...at(s, ...v), right: rightAngle(angleAt(v, points[(i - 1 + n) % n]!, points[(i + 1) % n]!)) };
  });
}

/**
 * A hand-drawn line through `points` (section-local): each point lands up to
 * `aim` px off, a long run wanders off true (a gentle bow, and an S-bend for
 * a shaky hand), and the pen trembles.
 */
function line(s: Sheet, points: XY[], aim = s.aim, j = s.trace): Stroke {
  const aimed = points.map(([x, y]) => at(s, x + spread(s, aim), y + spread(s, aim)));
  const out: Pt[] = [aimed[0]!];
  for (let i = 1; i < aimed.length; i++) {
    const [a, b] = [aimed[i - 1]!, aimed[i]!];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const reach = Math.min(1, len / 150);
    const bow = spread(s, s.bow * reach);
    const bend = spread(s, s.bend * reach);
    const n = Math.floor(len / 30);
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const off = bow * Math.sin(Math.PI * t) + bend * Math.sin(2 * Math.PI * t);
      out.push({ x: a.x + (b.x - a.x) * t - ((b.y - a.y) / len) * off, y: a.y + (b.y - a.y) * t + ((b.x - a.x) / len) * off });
    }
    out.push(b);
  }
  return penStroke(out, j);
}

/** A circle drawn the way people draw one: from anywhere on it, a little past a full turn, not quite round. */
function circle(s: Sheet, cx: number, cy: number, r: number): Stroke {
  const start = s.j.rng() * 360;
  const sweep = 360 + s.overshoot * (0.5 + s.j.rng() * 0.5);
  const rx = r * (1 + spread(s, s.oval));
  const ry = r * (1 + spread(s, s.oval));
  const c = { x: cx + spread(s, s.aim / 2), y: cy + spread(s, s.aim / 2) };
  const n = Math.ceil(sweep / 10);
  const points = Array.from({ length: n + 1 }, (_, i) => {
    const a = rad(start + (sweep * i) / n);
    return at(s, c.x + rx * Math.cos(a), c.y + ry * Math.sin(a));
  });
  return penStroke(points, s.trace);
}

/** An open arc about (cx, cy) — degrees, y-down, as in strokeFont's glyphs. */
function arcLine(s: Sheet, cx: number, cy: number, r: number, fromDeg: number, toDeg: number): Stroke {
  const n = Math.ceil(Math.abs(toDeg - fromDeg) / 6);
  const rr = r + spread(s, s.aim / 2);
  const points = Array.from({ length: n + 1 }, (_, i) => {
    const a = rad(fromDeg + ((toDeg - fromDeg) * i) / n);
    return at(s, cx + rr * Math.cos(a), cy + rr * Math.sin(a));
  });
  return penStroke(points, steady(s));
}

/** A dot, filled in the way a pen does it: a tight spiral in to the centre. */
function dot(s: Sheet, cx: number, cy: number, r = 4): Stroke {
  const c = { x: cx + spread(s, s.clean ? 0 : 1), y: cy + spread(s, s.clean ? 0 : 1) };
  const points = Array.from({ length: 37 }, (_, i) => {
    const a = rad(i * 30);
    const rr = r * (1 - i / 36);
    return at(s, c.x + rr * Math.cos(a), c.y + rr * Math.sin(a));
  });
  return penStroke(points);
}

/** A zigzag from `a` to `b` (horizontal): `turns` sharp corners, alternately `amp` px either side. */
function zigzag(s: Sheet, a: XY, b: XY, turns: number, amp: number): Stroke {
  const step = (b[0] - a[0]) / turns;
  const points: XY[] = [a];
  for (let k = 0; k < turns; k++) points.push([a[0] + (k + 0.5) * step, a[1] + (k % 2 === 0 ? -amp : amp)]);
  points.push(b);
  return line(s, points, s.aim * 0.4);
}

/** A wedge bond: a narrow triangle outline, its point at `a` and its wide end, `width` px across, at `b`. */
function wedge(s: Sheet, a: XY, b: XY, width: number): Stroke {
  const [ux, uy] = unit(a, b);
  const h = width / 2;
  return line(s, [a, [b[0] - uy * h, b[1] + ux * h], [b[0] + uy * h, b[1] - ux * h], a], s.aim * 0.4, steady(s));
}

/** A dashed (hashed) bond: `n` short strokes across the line from `a` to `b`, widening toward `b`. */
function hashes(s: Sheet, a: XY, b: XY, n: number, width: number): Stroke[] {
  const [ux, uy] = unit(a, b);
  return Array.from({ length: n }, (_, i) => {
    const t = (i + 0.5) / n;
    const c: XY = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const h = 2 + (width / 2 - 2) * t;
    return line(s, [[c[0] - uy * h, c[1] + ux * h], [c[0] + uy * h, c[1] - ux * h]], s.aim * 0.3, steady(s));
  });
}

function unit(a: XY, b: XY): XY {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
}

/** `a` moved `d` px toward `b`. */
function toward(a: XY, b: XY, d: number): XY {
  const [ux, uy] = unit(a, b);
  return [a[0] + ux * d, a[1] + uy * d];
}

function arrow(s: Sheet, id: string, tail: XY, tip: XY, barb = 14): string {
  const strokes = arrowStrokes(at(s, ...tail), at(s, ...tip), s.head, s.clean ? undefined : s.trace, barb);
  return shape(s, id, "arrow", strokes, { arrow: { tail: at(s, ...tail), tip: at(s, ...tip) } });
}

/** Writes `text` ("_" and "^" for scripts) with its ink centred on (cx, cy); the stroke indices. */
function write(s: Sheet, text: string, cx: number, cy: number, size: number): number[] {
  const ink = writeText(text, 0, 0, size).glyphs.flatMap((g) => g.strokes.flat());
  const xs = ink.map((p) => p.x);
  const ys = ink.map((p) => p.y);
  const x = cx - (Math.min(...xs) + Math.max(...xs)) / 2;
  const y = cy - (Math.min(...ys) + Math.max(...ys)) / 2;
  const { glyphs } = writeText(text, s.origin.x + x, s.origin.y + y, size, s.clean ? undefined : s.j);
  return put(s, glyphs.flatMap((g) => g.strokes));
}

/** A label, centred on (cx, cy); its index in the truth's labels. */
function label(s: Sheet, text: string, cx: number, cy: number, size: number, of?: TruthLabel["of"]): number {
  s.truth.labels.push({ text, strokes: write(s, text, cx, cy, size), ...(of ? { of } : {}) });
  return s.truth.labels.length - 1;
}

/** A worked formula, its top-left at (x, y); returns the text, for `expected`. */
function formula(s: Sheet, text: string, x: number, y: number): string {
  put(s, writeText(text, s.origin.x + x, s.origin.y + y, LABEL, s.clean ? undefined : s.j).glyphs.flatMap((g) => g.strokes));
  return text;
}

// ── the diagrams ─────────────────────────────────────────────────────────────
// Each draws into a 520 × 280 section (section-local coordinates) and returns
// what it wrote that isn't a label.

/** O=C=O, the double bonds as parallel pairs. */
function co2(s: Sheet): string[] {
  const y = 140;
  const size = 34;
  const bond = (id: string, x1: number, x2: number) =>
    shape(s, id, "parallel", [line(s, [[x1, y - 6], [x2, y - 6]], s.aim / 2), line(s, [[x1, y + 6], [x2, y + 6]], s.aim / 2)], { lines: 2 });

  const nodes: TruthGraph["nodes"] = [{ id: "O1", label: label(s, "O", 120, y, size) }];
  bond("bond-O1-C", 148, 238);
  nodes.push({ id: "C", label: label(s, "C", 260, y, size) });
  bond("bond-C-O2", 282, 372);
  nodes.push({ id: "O2", label: label(s, "O", 400, y, size) });
  s.truth.graph = {
    nodes,
    bonds: [
      { from: "O1", to: "C", type: "double", primitive: "bond-O1-C" },
      { from: "C", to: "O2", type: "double", primitive: "bond-C-O2" },
    ],
  };
  return [];
}

/** C with four H: up and lower left in the plane, a wedge to the right, a dashed bond down. */
function ch4(s: Sheet): string[] {
  const c: XY = [235, 130];
  const size = 30;
  const nodes: TruthGraph["nodes"] = [{ id: "C", label: label(s, "C", ...c, size) }];
  const bonds: TruthGraph["bonds"] = [];
  const arms = [["H1", -90, "single"], ["H2", 150, "single"], ["H3", 25, "wedge"], ["H4", 70, "dashed"]] as const;
  for (const [id, deg, type] of arms) {
    const h: XY = [c[0] + 100 * Math.cos(rad(deg)), c[1] + 100 * Math.sin(rad(deg))];
    const a = toward(c, h, 20);
    const b = toward(h, c, 23);
    const primitive = `bond-C-${id}`;
    if (type === "single") shape(s, primitive, "segment", [line(s, [a, b])]);
    if (type === "wedge") shape(s, primitive, "wedge", [wedge(s, a, b, 16)]);
    if (type === "dashed") shape(s, primitive, "dashed", hashes(s, a, b, 6, 16), { lines: 6 });
    nodes.push({ id, label: label(s, "H", ...h, size) });
    bonds.push({ from: "C", to: id, type, primitive });
  }
  s.truth.graph = { nodes, bonds };
  return [];
}

/**
 * α-D-glucopyranose, Haworth-style: a flattened hexagon, ring O at the back
 * right, each bond its own stroke. Up/down substituents on C1–C4 (the "up"
 * ones on the front carbons sit inside the ring, as in the printed
 * projection), CH₂OH up on C5; C5's H is left out.
 */
function glucose(s: Sheet): string[] {
  const size = 20;
  const v: Record<string, XY> = { O: [320, 95], C1: [390, 145], C2: [320, 195], C3: [180, 195], C4: [110, 145], C5: [180, 95] };
  const ring = ["O", "C1", "C2", "C3", "C4", "C5", "O"];

  const nodes: TruthGraph["nodes"] = [{ id: "O", label: label(s, "O", ...v.O!, 24) }];
  const bonds: TruthGraph["bonds"] = [];
  const ringBonds: string[] = [];
  for (let i = 0; i < 6; i++) {
    const [from, to] = [ring[i]!, ring[i + 1]!];
    // Bonds stop short of the written O.
    const a = from === "O" ? toward(v.O!, v[to]!, 18) : v[from]!;
    const b = to === "O" ? toward(v.O!, v[from]!, 18) : v[to]!;
    const primitive = shape(s, `bond-${from}-${to}`, "segment", [line(s, [a, b])]);
    ringBonds.push(primitive);
    bonds.push({ from, to, type: "single", primitive });
    if (to !== "O") nodes.push({ id: to, label: null });
  }
  // Ring bonds meet at every carbon: bond i ends where bond i + 1 starts. All six close a ring (through the written O).
  const ringBond = (k: number): [XY, XY] => [v[ring[k]!]!, v[ring[k + 1]!]!];
  for (let i = 0; i < 5; i++) connect(s, ringBonds[i]!, ringBonds[i + 1]!, "meet", linesRight(...ringBond(i), ...ringBond(i + 1)));
  s.truth.rings = [ringBonds];

  const groups: [string, -1 | 1, string][] = [
    ["C1", -1, "H"], ["C1", 1, "OH"], ["C2", -1, "H"], ["C2", 1, "OH"],
    ["C3", -1, "OH"], ["C3", 1, "H"], ["C4", -1, "H"], ["C4", 1, "OH"], ["C5", -1, "CH_2OH"],
  ];
  for (const [carbon, dir, text] of groups) {
    const [x, y] = v[carbon]!;
    const end = y + dir * 28;
    const id = `${carbon}-${text.replace("_", "")}`;
    const primitive = shape(s, `bond-${id}`, "segment", [line(s, [[x, y], [x, end]], s.aim * 0.6)]);
    nodes.push({ id, label: label(s, text, x, end + dir * (5 + size / 2), size) });
    bonds.push({ from: carbon, to: id, type: "single", primitive });
    // The two ring bonds at this carbon.
    const k = ring.indexOf(carbon);
    connect(s, primitive, ringBonds[k - 1]!, "meet", linesRight([x, y], [x, end], ...ringBond(k - 1)));
    connect(s, primitive, ringBonds[k]!, "meet", linesRight([x, y], [x, end], ...ringBond(k)));
  }
  s.truth.graph = { nodes, bonds };
  return [];
}

/** A car (body with a cabin, two wheels), a velocity arrow, a 100 m marker, and the speed worked out. */
function car(s: Sheet): string[] {
  const outline: XY[] = [[50, 120], [50, 88], [105, 88], [130, 50], [200, 50], [230, 88], [285, 95], [285, 120]];
  const body = shape(s, "body", "polygon", [line(s, closed(outline))], { count: 8, corners: cornersOf(s, outline, true) });
  for (const [id, x] of [["wheel-rear", 100], ["wheel-front", 235]] as const) {
    shape(s, id, "circle", [circle(s, x, 125, 18)]);
    connect(s, id, body, "touch");
  }
  const v = arrow(s, "velocity", [300, 85], [385, 85]);
  label(s, "v", 342, 68, LABEL, { primitive: v, at: "middle" });

  const distance = shape(s, "distance", "segment", [line(s, [[50, 170], [390, 170]])]);
  for (const [id, x] of [["tick-start", 50], ["tick-end", 390]] as const) {
    shape(s, id, "segment", [line(s, [[x, 160], [x, 180]], s.aim * 0.4)]);
    connect(s, id, distance, "meet", true);
  }
  label(s, "100 m", 220, 194, LABEL, { primitive: distance, at: "middle" });
  return [formula(s, "v = d/t = 100/5 = 20 m/s", 50, 225)];
}

/** A ball resting on a right-angled ramp, the base angle θ, the forces mg and N, and a = g sin θ. */
function incline(s: Sheet): string[] {
  const A: XY = [50, 200]; // the θ corner
  const corners: XY[] = [A, [370, 200], [370, 45]];
  const ramp = shape(s, "ramp", "triangle", [line(s, closed(corners))], { corners: cornersOf(s, corners, true) });
  const slope = Math.atan2(45 - A[1], 370 - A[0]); // up the slope, y-down radians (negative)
  const n: XY = [Math.sin(slope), -Math.cos(slope)]; // out of the slope, up and to the left
  const r = 24;
  const contact: XY = [A[0] + 160 * Math.cos(slope), A[1] + 160 * Math.sin(slope)];
  const c: XY = [contact[0] + (r + 2) * n[0], contact[1] + (r + 2) * n[1]];
  shape(s, "ball", "circle", [circle(s, ...c, r)]);
  connect(s, "ball", ramp, "touch");

  const deg = (slope * 180) / Math.PI;
  shape(s, "angle", "arc", [arcLine(s, ...A, 48, 0, deg)]);
  connect(s, "angle", ramp, "meet");
  (s.truth.cornerMarks ??= []).push({ mark: "angle", of: ramp, at: at(s, ...A) });
  label(s, "θ", A[0] + 66 * Math.cos(slope / 2), A[1] + 66 * Math.sin(slope / 2), 18, { primitive: "angle", at: "middle" });

  // Both forces drawn from the ball's centre.
  arrow(s, "weight", c, [c[0], c[1] + 75]);
  label(s, "mg", c[0] + 28, c[1] + 70, LABEL, { primitive: "weight", at: "head" });
  const tip: XY = [c[0] + 72 * n[0], c[1] + 72 * n[1]];
  arrow(s, "normal", c, tip);
  label(s, "N", tip[0] + 16 * n[0] - 8, tip[1] + 16 * n[1], LABEL, { primitive: "normal", at: "head" });
  return [formula(s, "a = g sin θ", 50, 222)];
}

/** One loop: a battery (long and short plate) on the left, a resistor zigzag along the top. */
function circuit(s: Sheet): string[] {
  const [left, right, top, bottom] = [130, 400, 60, 225];
  const [plus, minus] = [135, 149]; // the long and short plate
  const battery = shape(s, "battery", "parallel", [
    line(s, [[left - 25, plus], [left + 25, plus]], s.aim * 0.4),
    line(s, [[left - 12, minus], [left + 12, minus]], s.aim * 0.4),
  ], { lines: 2 });
  const inPath: XY[] = [[left, plus], [left, top], [215, top]];
  const outPath: XY[] = [[305, top], [right, top], [right, bottom], [left, bottom], [left, minus]];
  const wireIn = shape(s, "wire-1", "polyline", [line(s, inPath)], { count: 1, corners: cornersOf(s, inPath, false) });
  const resistor = shape(s, "resistor", "zigzag", [zigzag(s, [215, top], [305, top], 6, 11)], { count: 6 });
  const wireOut = shape(s, "wire-2", "polyline", [line(s, outPath)], { count: 3, corners: cornersOf(s, outPath, false) });
  // Each wire ends square on a plate; the resistor runs on in the wires' line.
  connect(s, wireIn, battery, "meet", true);
  connect(s, wireIn, resistor, "meet", false);
  connect(s, resistor, wireOut, "meet", false);
  connect(s, wireOut, battery, "meet", true);
  label(s, "9 V", 62, (plus + minus) / 2, LABEL, { primitive: battery, at: "near" });
  label(s, "R", 260, 30, LABEL, { primitive: resistor, at: "middle" });
  return [];
}

/** P and Q axes, a downward D and an upward S, and a dot where they cross. */
function supplyDemand(s: Sheet): string[] {
  const o: XY = [90, 230];
  const p = arrow(s, "axis-P", o, [90, 40], 12);
  label(s, "P", 66, 48, LABEL, { primitive: p, at: "head" });
  const q = arrow(s, "axis-Q", o, [430, 230], 12);
  label(s, "Q", 426, 256, LABEL, { primitive: q, at: "head" });
  connect(s, p, q, "meet", true);

  const d: [XY, XY] = [[135, 70], [385, 200]];
  const sup: [XY, XY] = [[135, 195], [385, 65]];
  shape(s, "demand", "segment", [line(s, d)]);
  label(s, "D", 404, 206, LABEL, { primitive: "demand", at: "end" });
  shape(s, "supply", "segment", [line(s, sup)]);
  label(s, "S", 404, 60, LABEL, { primitive: "supply", at: "end" });

  // Where the two lines cross.
  const md = (d[1][1] - d[0][1]) / (d[1][0] - d[0][0]);
  const ms = (sup[1][1] - sup[0][1]) / (sup[1][0] - sup[0][0]);
  const x = (sup[0][1] - d[0][1] + md * d[0][0] - ms * sup[0][0]) / (md - ms);
  shape(s, "equilibrium", "dot", [dot(s, x, d[0][1] + md * (x - d[0][0]))]);
  connect(s, "equilibrium", "demand", "touch");
  connect(s, "equilibrium", "supply", "touch");
  return [];
}

/** A right triangle, sides a, b, c, the right angle marked by a small square. */
function rightTriangle(s: Sheet): string[] {
  // Sides in drawing order: 0 the base (b), 1 the upright (a), 2 the hypotenuse (c).
  const corners: XY[] = [[100, 225], [390, 225], [390, 45]];
  const tri = shape(s, "triangle", "triangle", [line(s, closed(corners))], { corners: cornersOf(s, corners, true) });
  const square: XY[] = [[368, 225], [368, 203], [390, 203]];
  shape(s, "right-angle", "polyline", [line(s, square, s.aim * 0.4, steady(s))], { count: 1, corners: cornersOf(s, square, false) });
  // Its ends rest square on the two sides of the corner it sits in.
  connect(s, "right-angle", tri, "meet", true);
  (s.truth.cornerMarks ??= []).push({ mark: "right-angle", of: tri, at: at(s, 390, 225) });
  label(s, "b", 245, 250, LABEL, { primitive: tri, at: "side", side: 0 });
  label(s, "a", 412, 135, LABEL, { primitive: tri, at: "side", side: 1 });
  // Just outside the hypotenuse's middle, up and to the left.
  label(s, "c", 245 - 22 * 0.527, 135 - 22 * 0.85, LABEL, { primitive: tri, at: "side", side: 2 });
  return [];
}

const DRAW: Record<DiagramName, (s: Sheet) => string[]> = {
  co2, ch4, glucose, car, incline, circuit, "supply-demand": supplyDemand, "right-triangle": rightTriangle,
};

/**
 * With no options, the board as saved. `seed` draws the same diagrams in other
 * hands (a different one per section), for checks over many hands; `clean`
 * draws them with no jitter at all.
 */
export function planDiagramBoard(opts: { seed?: number; clean?: boolean } = {}): DiagramBoardPlan {
  const sections: DiagramSection[] = [];
  const strokes: Stroke[] = [];

  DIAGRAMS.forEach((diagram, d) => {
    STYLES.forEach((style, k) => {
      const id = `${diagram}-${style}`;
      const col = (d % 2) * 2 + k;
      const origin = { x: ORIGIN.x + col * COLUMN_PITCH, y: ORIGIN.y + Math.floor(d / 2) * ROW_PITCH };
      const rect: Rect = { minX: origin.x, minY: origin.y, maxX: origin.x + SECTION_W, maxY: origin.y + SECTION_H };
      const first = strokes.length;
      const base = opts.seed === undefined ? 7000 : 100_000 + opts.seed * 1000;
      const sheet: Sheet = { ...hand(style, base + (d * 2 + k) * 37, !!opts.clean), origin, strokes, truth: { primitives: [], labels: [] } };
      const expected = DRAW[diagram](sheet);

      // A region read is limited to the rect, so nothing may stray outside it.
      for (const p of strokes.slice(first).flat()) {
        if (p.x <= rect.minX || p.x >= rect.maxX || p.y <= rect.minY || p.y >= rect.maxY) {
          throw new Error(`diagramBoard: ${id} draws outside its section at (${p.x}, ${p.y})`);
        }
      }
      sections.push({ id, diagram, style, rect, depicts: DEPICTS[diagram], expected, truth: sheet.truth });
    });
  });

  const bounds: Rect = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const s of sections) {
    bounds.minX = Math.min(bounds.minX, s.rect.minX); bounds.minY = Math.min(bounds.minY, s.rect.minY);
    bounds.maxX = Math.max(bounds.maxX, s.rect.maxX); bounds.maxY = Math.max(bounds.maxY, s.rect.maxY);
  }
  return { sections, strokes, bounds };
}
