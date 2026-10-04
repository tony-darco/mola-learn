/**
 * Boards for the canvas reader (lib/canvas/textSyntax/read.ts): a small board
 * per kind of element, and the composite board — the canvas-syntax eval's
 * handwritten matrix reduction with one of everything else placed or drawn
 * around it. Pen marks are drawn with the stroke font's seeded jitter, so
 * each seed is a different, deterministic hand.
 *
 * The composite board carries its truth — every pen mark by its stroke ids,
 * and what each mark, connector and frame is about — keyed by element id so
 * it doesn't lean on the labels the reader hands out. The addresses in it
 * are the labels a first read gives (reading order), which is also what the
 * QA questions expect.
 */
import { generateKeyBetween } from "fractional-indexing";
import type { CanvasElement, CanvasShapeElement } from "@mola/shared";
import type { ItemKind } from "@/lib/canvas/textSyntax/read";
import { recomputeParentIds } from "@/lib/canvas/membership";
import { finalizeStroke } from "@/lib/canvas/stroke";
import { COLOR_PALETTE, NOTE_DEFAULT_COLOR, STROKE_WIDTHS } from "@/lib/canvas/styleConstants";
import { planMatrixReduction, type MatrixPlan } from "@/e2e/support/matrixPlan";
import { arrowStrokes, loopStroke, makeJitter, straightStroke, textStrokes, type Jitter, type Pt, type Stroke } from "@/e2e/support/strokeFont";
import { planElements } from "../canvas-syntax/fixtures";

// ── elements ────────────────────────────────────────────────────────────────

type Who = { ai?: boolean };
const INK = COLOR_PALETTE[0]!;

const base = (id: string, x: number, y: number, width: number, height: number, who: Who = {}) => ({
  id, parentId: null, index: "a0", x, y, width, height, rotation: 0, opacity: 1, createdBy: who.ai ? "ai" as const : "user" as const,
});

export const textBox = (id: string, x: number, y: number, text: string, who?: Who & { width?: number }): CanvasElement => ({
  ...base(id, x, y, who?.width ?? 220, 24 * text.split("\n").length, who), type: "text",
  props: { text, color: INK, fontSize: 16, backgroundColor: null, bold: false, italic: false, textAlign: "left", autoFit: "grow" },
});

export const note = (id: string, x: number, y: number, text: string): CanvasElement => ({
  ...base(id, x, y, 180, 120), type: "note",
  props: { text, color: NOTE_DEFAULT_COLOR, textColor: "#1c1b18", fontSize: 16, bold: false, italic: false, textAlign: "left", autoFit: "grow" },
});

export const math = (id: string, x: number, y: number, latex: string): CanvasElement => ({
  ...base(id, x, y, 180, 40), type: "math", props: { latex, color: INK, fontSize: 16 },
});

export const image = (id: string, x: number, y: number, width: number, height: number): CanvasElement => ({
  ...base(id, x, y, width, height), type: "image", props: { url: `https://example.test/${id}.png`, naturalWidth: width * 2, naturalHeight: height * 2 },
});

export const frame = (id: string, x: number, y: number, width: number, height: number, name: string): CanvasElement => ({
  ...base(id, x, y, width, height), type: "frame", props: { name },
});

export const shape = (id: string, shapeKind: CanvasShapeElement["props"]["shapeKind"], x: number, y: number, width: number, height: number): CanvasElement => ({
  ...base(id, x, y, width, height), type: "shape",
  props: { shapeKind, color: INK, fillColor: null, fillStyle: "none", strokeWidth: STROKE_WIDTHS.M, dash: "solid" },
});

/** The line tool: `arrow` puts a head on its end (the arrow tool), its start, or both. */
export const line = (id: string, from: Pt, to: Pt, arrow: "none" | "end" | "start" | "both" = "none"): CanvasElement => ({
  ...base(id, from.x, from.y, Math.abs(to.x - from.x), Math.abs(to.y - from.y)), type: "line",
  props: {
    endX: to.x - from.x, endY: to.y - from.y, color: INK, strokeWidth: STROKE_WIDTHS.M, dash: "solid",
    startArrow: arrow === "start" || arrow === "both", endArrow: arrow === "end" || arrow === "both",
  },
});

/** One stroke of the pen or highlighter tool, as the canvas saves it. */
export function drawn(id: string, stroke: Stroke, variant: "pen" | "highlighter" = "pen", who?: Who): CanvasElement {
  const f = finalizeStroke(stroke);
  if (!f) throw new Error(`fixtures: stroke ${id} has fewer than 2 points`);
  return {
    ...base(id, f.x, f.y, f.width, f.height, who), type: "draw",
    props: { points: f.points, color: INK, strokeWidth: STROKE_WIDTHS.M, variant, dash: "solid" },
  };
}

/** Handwritten `text` as pen strokes `${prefix}0`, `${prefix}1`, …. */
export const written = (prefix: string, text: string, x: number, y: number, size: number, jitter?: Jitter, who?: Who) =>
  textStrokes(text, x, y, size, jitter).map((s, i) => drawn(`${prefix}${i}`, s, "pen", who));

/** Stacking order, then frame membership, as the canvas would have left them. */
function finish(elements: CanvasElement[]): CanvasElement[] {
  let index: string | null = null;
  return recomputeParentIds(elements.map((e) => ({ ...e, index: (index = generateKeyBetween(index, null)) })));
}

// ── one of each ─────────────────────────────────────────────────────────────

/** Small boards, one kind of element each (with whatever it needs to be about). */
export const SINGLES: Record<string, () => CanvasElement[]> = {
  "text box": () => finish([textBox("t", 100, 100, "Hello, board")]),
  "text box, two lines": () => finish([textBox("t", 100, 100, "First line\nSecond line")]),
  "sticky note": () => finish([note("n", 100, 100, "Remember: pivot first")]),
  math: () => finish([math("q", 100, 100, "\\frac{a}{b} = c")]),
  image: () => finish([image("i", 100, 100, 320, 240)]),
  frame: () => finish([frame("f", 50, 50, 300, 200, "Scratch"), textBox("t", 100, 100, "inside", { width: 120 })]),
  shape: () => finish([shape("s", "rectangle", 80, 80, 200, 64), textBox("t", 100, 100, "boxed", { width: 120 })]),
  line: () => finish([textBox("a", 100, 100, "left", { width: 60 }), textBox("b", 400, 100, "right", { width: 60 }), line("l", { x: 165, y: 112 }, { x: 395, y: 112 })]),
  arrow: () => finish([note("n", 400, 100, "target"), line("l", { x: 100, y: 400 }, { x: 420, y: 210 }, "end")]),
  "pen circle": () => finish([...written("w", "R1 = R2", 100, 100, 30), drawn("c", loopStroke(257, 115, 32, 24))]),
  "pen arrow": () => finish([
    ...written("a", "R1", 100, 100, 30), ...written("b", "R2", 100, 300, 30),
    ...arrowStrokes({ x: 115, y: 140 }, { x: 115, y: 290 }, "separate").map((s, i) => drawn(`arrow${i}`, s)),
  ]),
  "pen underline": () => finish([...written("w", "R1 = R2", 100, 100, 30), drawn("u", straightStroke({ x: 96, y: 138 }, { x: 150, y: 138 }))]),
  highlighter: () => finish([...written("w", "R1 = R2", 100, 100, 30), drawn("h", straightStroke({ x: 96, y: 115 }, { x: 180, y: 115 }), "highlighter")]),
  "text box made by the AI": () => finish([textBox("t", 100, 100, "Try R2 - 2R1", { ai: true })]),
};

// ── the composite board ─────────────────────────────────────────────────────

/** An item the reader must find, by one of its element ids, with what it must say about it. */
export type Expected = {
  id: string; kind: ItemKind;
  targets?: string[];
  ends?: [string | null, string | null];
  madeByAI?: boolean | "partly";
};
export type Truth = {
  /** Every pen mark on the board, by its stroke ids — and no others. */
  marks: { kind: "circle" | "arrow" | "underline"; ids: string[] }[];
  items: Expected[];
};
export type BoardFixture = {
  name: string; jitterSeed?: number; penArrowHead: "separate" | "joined";
  plan: MatrixPlan; elements: CanvasElement[]; truth: Truth;
};

export const BOARD_TEXT = {
  textBox: "Pivot on R1 first",
  math: "\\det(A) = -1",
  note: "Solution: x = 1, y = 2, z = 3",
  ai: "Nice work, every step checks out.",
  frame: "Final answer",
};

/**
 * The matrix reduction (M1–M8, labels T1–T7) plus: a pen circle round M2
 * row 2 col 3, a pen arrow from M4 to M5, a pen underline under T1 word 6
 * ("2R1"), a highlighter stroke over T5 words 2–4, a text box, a math
 * element, a sticky note, an image, a tool arrow from M8 to the note, a tool
 * ellipse round T7, a frame round M8, and a text box made by the AI.
 */
export function makeBoard(name: string, opts: { jitterSeed?: number; penArrowHead?: "separate" | "joined" } = {}): BoardFixture {
  const { jitterSeed } = opts;
  const penArrowHead = opts.penArrowHead ?? "separate";
  const plan = planMatrixReduction({ jitterSeed });
  // Marks get their own jitter stream, so the handwriting is exactly the canvas-syntax fixture's.
  const jitter = jitterSeed === undefined ? undefined : makeJitter(1000 + jitterSeed);

  const arrow = arrowStrokes({ x: 706, y: 770 }, { x: 781, y: 182 }, penArrowHead, jitter);
  const arrowIds = arrow.length === 1 ? ["pen-arrow"] : ["pen-arrow-shaft", "pen-arrow-head"];
  const elements = finish([
    ...planElements(plan),
    drawn("pen-circle", loopStroke(538, 372, 34, 23, jitter)),
    ...arrow.map((s, i) => drawn(arrowIds[i]!, s)),
    drawn("pen-underline", straightStroke({ x: 558, y: 286 }, { x: 620, y: 286 }, jitter)),
    drawn("highlight", straightStroke({ x: 866, y: 266 }, { x: 1010, y: 266 }, jitter), "highlighter"),
    textBox("textbox", 1290, 110, BOARD_TEXT.textBox, { width: 200 }),
    math("math", 1290, 170, BOARD_TEXT.math),
    note("note", 1290, 560, BOARD_TEXT.note),
    image("image", 1530, 110, 200, 150),
    line("tool-arrow", { x: 1216, y: 764 }, { x: 1312, y: 672 }, "end"),
    shape("ellipse", "ellipse", 806, 626, 322, 64),
    frame("frame", 770, 686, 455, 160, BOARD_TEXT.frame),
    textBox("ai-text", 1290, 760, BOARD_TEXT.ai, { width: 260, ai: true }),
  ]);

  const truth: Truth = {
    marks: [
      { kind: "circle", ids: ["pen-circle"] },
      { kind: "arrow", ids: arrowIds },
      { kind: "underline", ids: ["pen-underline"] },
    ],
    items: [
      { id: "pen-circle", kind: "circle", targets: ["M2 row 2 col 3"] },
      { id: arrowIds[0]!, kind: "arrow", ends: ["M4", "M5"] },
      { id: "pen-underline", kind: "underline", targets: ["T1 word 6"] },
      { id: "highlight", kind: "highlight", targets: ["T5 words 2–4"] },
      { id: "ellipse", kind: "shape", targets: ["T7"] },
      { id: "frame", kind: "frame", targets: ["M8"] },
      { id: "tool-arrow", kind: "arrow", ends: ["M8", "N1"] },
      { id: "textbox", kind: "text", madeByAI: false },
      { id: "math", kind: "math" },
      { id: "note", kind: "note" },
      { id: "image", kind: "image" },
      { id: "ai-text", kind: "text", madeByAI: true },
    ],
  };
  return { name, jitterSeed, penArrowHead, plan, elements, truth };
}

/** Selections of the composite board shown in the report: one cutting through handwriting, one an arrow leaves. */
export const REGIONS = {
  "M1 row 2, cut through": { minX: 270, minY: 150, maxX: 710, maxY: 200 },
  "T1 and M2 with their marks": { minX: 270, minY: 245, maxX: 710, maxY: 445 },
  "the sticky note and the arrow into it": { minX: 1230, minY: 540, maxX: 1500, maxY: 800 },
};
