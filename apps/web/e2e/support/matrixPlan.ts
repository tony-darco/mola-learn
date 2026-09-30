/**
 * Lays a matrix reduction out as pen strokes: each step is an augmented
 * matrix in brackets, with a down-arrow and the row operation that produces
 * the next one underneath. Steps flow down a column, then wrap to the next.
 *
 * Pure and deterministic — same system + origin (+ jitter seed) in,
 * identical strokes out. Coordinates are svg-local pixels; with the canvas at
 * its default identity viewport those are also the world coordinates the
 * saved elements end up at.
 *
 * Alongside the strokes it returns `meta` (one entry per stroke: what that
 * stroke is part of) and `steps` (the true matrices and labels) — the ground
 * truth the canvas-syntax eval scores against.
 */
import { formatOp, reduce, EXAMPLE_SYSTEM, type Matrix, type ReductionSystem } from "./matrixReduction";
import { distort, makeJitter, penStroke, textGlyphs, textWidth, type Jitter, type Pt, type Stroke } from "./strokeFont";

const ENTRY_SIZE = 30; // cap height of the numbers inside a matrix
const LABEL_SIZE = 22; // cap height of the row-operation label
const ARROW_SIZE = 30;
const ROW_H = 44;
// Wide enough that the gap between two entries is clearly bigger than the gap
// between two digits of one entry ("11") — the way people space a matrix.
const COL_W = 90;
const BAR_GAP = 24; // extra room before the augmented column, where the bar goes
const BRACKET_ARM = 10;
const BRACKET_PAD = 12;
const ARROW_GAP = 8;
const BLOCK_GAP = 26;
const COLUMN_GAP = 90;
const ROWS_PER_COLUMN = 4;
const LABEL_OFFSET_X = 84; // label starts this far right of its block's left edge
const ARROW_OFFSET_X = 40;
/** Brackets and bars lean far less than letters do. */
const STRUCTURE_SLANT_DEG = 2;

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

/** What one planned stroke is part of. `step` indexes `MatrixPlan.steps`. */
export type StrokeMeta =
  | { role: "delimiter"; step: number; side: "left" | "right" }
  | { role: "bar"; step: number }
  | {
      role: "glyph"; step: number;
      /** Global glyph number — every stroke of one character shares it. */
      glyph: number;
      char: string;
      place: { kind: "cell"; row: number; col: number } | { kind: "label"; word: number };
    };

/** One step as written: the matrix, and the label drawn under it (null for the last step). */
export type PlannedStep = { matrix: Matrix; label: string | null };

export type MatrixPlan = { strokes: Stroke[]; meta: StrokeMeta[]; bounds: Bounds; steps: PlannedStep[] };

function matrixHeight(m: Matrix): number {
  return m.length * ROW_H;
}

function matrixWidth(m: Matrix): number {
  return BRACKET_ARM + BRACKET_PAD + m[0]!.length * COL_W + BAR_GAP + BRACKET_PAD;
}

export function planMatrixReduction({
  system = EXAMPLE_SYSTEM,
  origin = { x: 280, y: 110 },
  jitterSeed,
}: { system?: ReductionSystem; origin?: { x: number; y: number }; jitterSeed?: number } = {}): MatrixPlan {
  const jitter: Jitter | undefined = jitterSeed === undefined ? undefined : makeJitter(jitterSeed);
  const reduction = reduce(system);
  const first = reduction[0]!.matrix;
  const longestLabel = Math.max(0, ...system.ops.map((op) => textWidth(formatOp(op), LABEL_SIZE)));
  const columnPitch = Math.max(matrixWidth(first), LABEL_OFFSET_X + longestLabel) + COLUMN_GAP;
  const blockPitch = matrixHeight(first) + ARROW_GAP + ARROW_SIZE + BLOCK_GAP;

  const strokes: Stroke[] = [];
  const meta: StrokeMeta[] = [];
  const steps: PlannedStep[] = [];
  let glyphCount = 0;

  /** A structural mark (bracket, bar) drawn as one unit. */
  function addShape(points: Pt[], m: StrokeMeta) {
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    const [shaped] = jitter ? distort([points], box, jitter, STRUCTURE_SLANT_DEG) : [points];
    strokes.push(penStroke(shaped!, jitter));
    meta.push(m);
  }

  function addText(
    text: string, x: number, y: number, size: number, step: number,
    place: (g: { word: number }) => Extract<StrokeMeta, { role: "glyph" }>["place"],
  ) {
    for (const g of textGlyphs(text, x, y, size, jitter)) {
      const glyph = glyphCount++;
      for (const s of g.strokes) {
        strokes.push(s);
        meta.push({ role: "glyph", step, glyph, char: g.char, place: place(g) });
      }
    }
  }

  reduction.forEach((current, step) => {
    const m = current.matrix;
    const bx = origin.x + Math.floor(step / ROWS_PER_COLUMN) * columnPitch;
    const by = origin.y + (step % ROWS_PER_COLUMN) * blockPitch;
    const cols = m[0]!.length;
    const h = matrixHeight(m);
    const innerLeft = bx + BRACKET_ARM + BRACKET_PAD;
    const rightEdge = innerLeft + cols * COL_W + BAR_GAP + BRACKET_PAD;
    const barX = innerLeft + (cols - 1) * COL_W + BAR_GAP / 2;
    const colLeft = (c: number) => innerLeft + c * COL_W + (c === cols - 1 ? BAR_GAP : 0);

    addShape([{ x: bx + BRACKET_ARM, y: by }, { x: bx, y: by }, { x: bx, y: by + h }, { x: bx + BRACKET_ARM, y: by + h }], { role: "delimiter", step, side: "left" });
    addShape([{ x: rightEdge - BRACKET_ARM, y: by }, { x: rightEdge, y: by }, { x: rightEdge, y: by + h }, { x: rightEdge - BRACKET_ARM, y: by + h }], { role: "delimiter", step, side: "right" });
    addShape([{ x: barX, y: by + 4 }, { x: barX, y: by + h - 4 }], { role: "bar", step });

    // Entries are right-aligned in their column, in row-major order.
    m.forEach((row, r) => {
      row.forEach((value, c) => {
        const text = String(value);
        const tx = colLeft(c) + COL_W - textWidth(text, ENTRY_SIZE) - 8;
        const ty = by + r * ROW_H + (ROW_H - ENTRY_SIZE) / 2;
        addText(text, tx, ty, ENTRY_SIZE, step, () => ({ kind: "cell", row: r, col: c }));
      });
    });

    const next = reduction[step + 1];
    let label: string | null = null;
    if (next?.op) {
      const top = by + h + ARROW_GAP;
      const opText = formatOp(next.op);
      label = `↓ ${opText}`;
      // The arrow is word 0 of the label line; the operation's words follow it.
      addText("↓", bx + ARROW_OFFSET_X, top, ARROW_SIZE, step, () => ({ kind: "label", word: 0 }));
      addText(opText, bx + LABEL_OFFSET_X, top + (ARROW_SIZE - LABEL_SIZE) / 2, LABEL_SIZE, step, (g) => ({ kind: "label", word: g.word + 1 }));
    }
    steps.push({ matrix: m, label });
  });

  const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const stroke of strokes) {
    for (const p of stroke) {
      bounds.minX = Math.min(bounds.minX, p.x);
      bounds.minY = Math.min(bounds.minY, p.y);
      bounds.maxX = Math.max(bounds.maxX, p.x);
      bounds.maxY = Math.max(bounds.maxY, p.y);
    }
  }
  return { strokes, meta, bounds, steps };
}
