/**
 * Lays a matrix reduction out as pen strokes: each step is an augmented
 * matrix in brackets, with a down-arrow and the row operation that produces
 * the next one underneath. Steps flow down a column, then wrap to the next.
 *
 * Pure and deterministic — same system + origin in, identical strokes out.
 * Coordinates are svg-local pixels; with the canvas at its default identity
 * viewport those are also the world coordinates the saved elements end up at.
 */
import { formatOp, reduce, EXAMPLE_SYSTEM, type Matrix, type ReductionSystem } from "./matrixReduction";
import { penStroke, textStrokes, textWidth, type Stroke } from "./strokeFont";

const ENTRY_SIZE = 30; // cap height of the numbers inside a matrix
const LABEL_SIZE = 22; // cap height of the row-operation label
const ARROW_SIZE = 30;
const ROW_H = 44;
const COL_W = 66; // wide enough for "-1" / "11" plus breathing room
const BAR_GAP = 24; // extra room before the augmented column, where the bar goes
const BRACKET_ARM = 10;
const BRACKET_PAD = 12;
const ARROW_GAP = 8;
const BLOCK_GAP = 26;
const COLUMN_GAP = 90;
const ROWS_PER_COLUMN = 4;
const LABEL_OFFSET_X = 84; // label starts this far right of its block's left edge

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
export type MatrixPlan = { strokes: Stroke[]; bounds: Bounds };

function matrixHeight(m: Matrix): number {
  return m.length * ROW_H;
}

function matrixWidth(m: Matrix): number {
  return BRACKET_ARM + BRACKET_PAD + m[0]!.length * COL_W + BAR_GAP + BRACKET_PAD;
}

/** Brackets, the augmented bar, and every entry (right-aligned in its column), in row-major order. */
function matrixStrokes(m: Matrix, x: number, y: number): Stroke[] {
  const cols = m[0]!.length;
  const h = matrixHeight(m);
  const innerLeft = x + BRACKET_ARM + BRACKET_PAD;
  const innerWidth = cols * COL_W + BAR_GAP;
  const rightEdge = innerLeft + innerWidth + BRACKET_PAD;
  const colLeft = (c: number) => innerLeft + c * COL_W + (c === cols - 1 ? BAR_GAP : 0);

  const out: Stroke[] = [
    penStroke([{ x: x + BRACKET_ARM, y }, { x, y }, { x, y: y + h }, { x: x + BRACKET_ARM, y: y + h }]),
    penStroke([{ x: rightEdge - BRACKET_ARM, y }, { x: rightEdge, y }, { x: rightEdge, y: y + h }, { x: rightEdge - BRACKET_ARM, y: y + h }]),
    penStroke([{ x: innerLeft + (cols - 1) * COL_W + BAR_GAP / 2, y: y + 4 }, { x: innerLeft + (cols - 1) * COL_W + BAR_GAP / 2, y: y + h - 4 }]),
  ];

  m.forEach((row, r) => {
    row.forEach((value, c) => {
      const text = String(value);
      const tx = colLeft(c) + COL_W - textWidth(text, ENTRY_SIZE) - 8;
      const ty = y + r * ROW_H + (ROW_H - ENTRY_SIZE) / 2;
      out.push(...textStrokes(text, tx, ty, ENTRY_SIZE));
    });
  });
  return out;
}

export function planMatrixReduction(
  system: ReductionSystem = EXAMPLE_SYSTEM,
  origin: { x: number; y: number } = { x: 280, y: 110 },
): MatrixPlan {
  const steps = reduce(system);
  const first = steps[0]!.matrix;
  const longestLabel = Math.max(0, ...system.ops.map((op) => textWidth(formatOp(op), LABEL_SIZE)));
  const columnPitch = Math.max(matrixWidth(first), LABEL_OFFSET_X + longestLabel) + COLUMN_GAP;
  const blockPitch = matrixHeight(first) + ARROW_GAP + ARROW_SIZE + BLOCK_GAP;

  const strokes: Stroke[] = [];
  steps.forEach((step, i) => {
    const bx = origin.x + Math.floor(i / ROWS_PER_COLUMN) * columnPitch;
    const by = origin.y + (i % ROWS_PER_COLUMN) * blockPitch;
    strokes.push(...matrixStrokes(step.matrix, bx, by));

    const next = steps[i + 1];
    if (next?.op) {
      const top = by + matrixHeight(step.matrix) + ARROW_GAP;
      strokes.push(...textStrokes("↓", bx + 40, top, ARROW_SIZE));
      strokes.push(...textStrokes(formatOp(next.op), bx + LABEL_OFFSET_X, top + (ARROW_SIZE - LABEL_SIZE) / 2, LABEL_SIZE));
    }
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
  return { strokes, bounds };
}
