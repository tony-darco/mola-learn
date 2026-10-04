/**
 * Exact, integer-only Gauss–Jordan elimination, expressed as an explicit list
 * of row operations so the canvas test can draw every intermediate matrix
 * and the operation that produced it. Nothing here is generated or random.
 */
export type Matrix = number[][];

export type RowOp =
  /** R[target] = R[target] + factor * R[source] */
  | { kind: "add"; target: number; source: number; factor: number }
  /** R[row] = factor * R[row] */
  | { kind: "scale"; row: number; factor: number };

export type ReductionSystem = { matrix: Matrix; ops: RowOp[] };
/** One frame of the worked example: the matrix, and the op that produced it (null for the starting matrix). */
export type ReductionStep = { matrix: Matrix; op: RowOp | null };

/**
 *   x +  y +  z =  6
 *  2x + 3y +  z = 11        →  x = 1, y = 2, z = 3
 *   x -  y + 2z =  5
 *
 * Every operation keeps all entries whole numbers, so the pen never has to
 * write a fraction.
 */
export const EXAMPLE_SYSTEM: ReductionSystem = {
  matrix: [
    [1, 1, 1, 6],
    [2, 3, 1, 11],
    [1, -1, 2, 5],
  ],
  ops: [
    { kind: "add", target: 1, source: 0, factor: -2 }, // R2 = R2 - 2R1
    { kind: "add", target: 2, source: 0, factor: -1 }, // R3 = R3 - R1
    { kind: "add", target: 2, source: 1, factor: 2 }, //  R3 = R3 + 2R2
    { kind: "scale", row: 2, factor: -1 }, //             R3 = -R3
    { kind: "add", target: 1, source: 2, factor: 1 }, //  R2 = R2 + R3
    { kind: "add", target: 0, source: 2, factor: -1 }, // R1 = R1 - R3
    { kind: "add", target: 0, source: 1, factor: -1 }, // R1 = R1 - R2
  ],
};

export function applyOp(m: Matrix, op: RowOp): Matrix {
  const next = m.map((row) => [...row]);
  if (op.kind === "scale") {
    // "+ 0" turns the -0 that negating a zero produces back into a plain 0.
    next[op.row] = m[op.row]!.map((v) => v * op.factor + 0);
  } else {
    next[op.target] = m[op.target]!.map((v, c) => v + op.factor * m[op.source]![c]!);
  }
  if (next.some((row) => row.some((v) => !Number.isInteger(v)))) {
    throw new Error(`matrixReduction: ${formatOp(op)} produced a non-integer entry`);
  }
  return next;
}

/** Human label for an op, using only characters the stroke font can draw. */
export function formatOp(op: RowOp): string {
  if (op.kind === "scale") {
    const r = `R${op.row + 1}`;
    return `${r} = ${op.factor === -1 ? "-" : op.factor}${r}`;
  }
  const t = `R${op.target + 1}`;
  const s = `R${op.source + 1}`;
  const magnitude = Math.abs(op.factor) === 1 ? "" : String(Math.abs(op.factor));
  return `${t} = ${t} ${op.factor < 0 ? "-" : "+"} ${magnitude}${s}`;
}

/** Every matrix along the way, starting with the input. */
export function reduce(system: ReductionSystem): ReductionStep[] {
  const steps: ReductionStep[] = [{ matrix: system.matrix, op: null }];
  for (const op of system.ops) {
    steps.push({ matrix: applyOp(steps[steps.length - 1]!.matrix, op), op });
  }
  return steps;
}
