/**
 * The ground truth a diagram board carries — what was drawn, in terms the
 * sketch layer (lib/canvas/textSyntax) is checked against — and nothing
 * else: types only. The diagram board's plan (diagramBoard.ts) fills it in
 * for each section, from the strokes it draws, so the truth can never drift
 * from the drawing.
 *
 * Everything that was drawn is referred to by the strokes it was drawn
 * with — indices into the plan's `strokes` — so a check can match what the
 * detector found to what was drawn by the strokes they share, whatever ids
 * or order either side uses.
 *
 * Kinds of primitive, as the detector is expected to tell them apart:
 *
 *   segment    one straight line
 *   polyline   an open path of straight runs meeting at corners — an angle,
 *              a car's body drawn in one stroke, an L of two axes
 *   arrow      a line (straight or not) with a head at one end; drawn in
 *              one stroke, or a shaft and a separate V — and which way
 *              it points
 *   circle     a closed, round loop — a wheel, a pulley (`round: false`
 *              for a clearly oval one)
 *   triangle, rectangle, polygon
 *              a closed shape of 3, 4, or `sides` straight sides — an
 *              incline, a block, a battery's case, a ring drawn closed
 *   arc        an open, circular curve — the marker of an angle
 *   curve      an open, smooth curve that isn't circular — a trajectory,
 *              a curved demand line
 *   zigzag     a line of sharp back-and-forth turns — a resistor
 *   coil       a line of repeated loops along an axis — a spring
 *   wedge      a narrow closed triangle — a wedge bond, toward the viewer
 *   dashed     a row of short strokes along a line — a dashed bond (the
 *              strokes across the line) or a dashed line (along it)
 *   parallel   two or three straight lines side by side, about the same
 *              length — a double or triple bond, a battery's plates
 *   dot        a small, filled point — an equilibrium point
 */
import type { Rect } from "./readerBoard";

export type PrimitiveKind =
  | "segment" | "polyline" | "arrow" | "circle" | "triangle" | "rectangle" | "polygon"
  | "arc" | "curve" | "zigzag" | "coil" | "wedge" | "dashed" | "parallel" | "dot";

/** A point in board coordinates. */
export type TruthPoint = { x: number; y: number };

/** Whether an angle was drawn as a right angle (within 1°), as clearly not one (more than 15° off), or too near one to check (null). */
export type RightAngle = boolean | null;

/** One thing drawn, and the strokes it was drawn with. `id` is unique within its section ("wheel-front", "bond-C-H2"). */
export type TruthPrimitive = {
  id: string;
  kind: PrimitiveKind;
  /** Indices into the plan's `strokes`. */
  strokes: number[];
  /** polygon: how many sides. polyline: how many corners. zigzag: how many turns. coil: how many loops. */
  count?: number;
  /** parallel: 2 or 3 lines. dashed: how many strokes. */
  lines?: number;
  /** circle: false for a clearly oval loop. */
  round?: boolean;
  /** arrow: where its tail and tip were aimed. */
  arrow?: { tail: TruthPoint; tip: TruthPoint };
  /** polyline, triangle, rectangle, polygon: each corner where it was aimed, in drawing order, and whether it is a right angle. */
  corners?: (TruthPoint & { right: RightAngle })[];
};

/** Where on a primitive a label sits. */
export type LabelPlace =
  | "start" | "end"          // by one end of a segment, polyline or curve (start = where it was drawn from)
  | "tail" | "head"          // by an arrow's tail or head
  | "middle"                 // by the middle of a line, beside it
  | "side"                   // beside one side of a closed shape (`side`: which, 0-based in drawing order)
  | "vertex"                 // at a corner (`vertex`: which, 0-based in drawing order)
  | "inside"                 // within a closed shape
  | "near";                  // close by, nothing more specific

/** Something written: a label, as written — "_" before a subscript character and "^" before a superscript, as in readerBoard's `expected`. */
export type TruthLabel = {
  text: string;
  /** Indices into the plan's `strokes`. */
  strokes: number[];
  /** What it labels, if anything. */
  of?: { primitive: string; at: LabelPlace; side?: number; vertex?: number };
};

/**
 * Two primitives that join: their ends (or an end and a side) `meet`, one `touch`es the other's side, or one lies `inside` the other.
 * `right`: for two straight lines that meet, whether they run at a right angle there (unset: not checked).
 */
export type TruthConnection = { a: string; b: string; how: "meet" | "touch" | "inside"; right?: RightAngle };

export type BondType = "single" | "double" | "triple" | "wedge" | "dashed";

/**
 * A molecule as a graph: atoms are nodes — a written label ("C", "H", "OH",
 * "CH_2OH"), or, where lines meet at an unlabelled corner (a carbon in a
 * ring), `label: null` — and bonds are edges, each drawn as one primitive.
 */
export type TruthGraph = {
  /** `id` is unique within the section ("C", "H1", "ring-2"); `label` is the index in `labels` of what it was written as. */
  nodes: { id: string; label: number | null }[];
  bonds: { from: string; to: string; type: BondType; primitive: string }[];
};

/** Everything checkable about one drawing. */
export type DiagramTruth = {
  primitives: TruthPrimitive[];
  labels: TruthLabel[];
  connections?: TruthConnection[];
  graph?: TruthGraph;
  /** Straight lines joined end to end into a closed ring, each ring's primitives in order round it. */
  rings?: string[][];
  /** A small primitive set across a corner of another, an end on each of the two sides that meet there — the arc of an angle, the square of a right angle. */
  cornerMarks?: { mark: string; of: string; at: TruthPoint }[];
};

export type DiagramName = "co2" | "ch4" | "glucose" | "car" | "incline" | "circuit" | "supply-demand" | "right-triangle";
export type DiagramStyle = "neat" | "shaky";

/** One section of the diagram board: one drawing in one style. */
export type DiagramSection = {
  id: string;
  diagram: DiagramName;
  style: DiagramStyle;
  /** World-coordinate area of the section — what a region read is limited to. */
  rect: Rect;
  /** What it depicts, in plain English — for the report's reader only; never written on the board or shown to a model. */
  depicts: string;
  /** Anything written beside the drawing that isn't a label (a worked formula), line by line, "_" and "^" as in TruthLabel. */
  expected: string[];
  truth: DiagramTruth;
};
