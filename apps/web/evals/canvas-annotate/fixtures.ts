/**
 * The boards the canvas-annotate eval asks the model to check: the 8-step
 * matrix reduction the pen-tool e2e draws, with one entry of the last step
 * written wrong, and a handwritten "2 + 2 = 5" off to the right of it.
 *
 * The slip is in the last step so that nothing after it disagrees with it:
 * every other entry on the board is right, and the right value follows from
 * the step before and the row operation between them (R1 = R1 - R2 gives
 * 3 - 2 = 1; the board says 5).
 *
 * Ground truth per planted error: the stroke ids written for it, their box,
 * what was written and what is right, and its address in the read
 * ("M8 row 1 col 4", "T8 word 5").
 */
import type { CanvasElement } from "@mola/shared";
import { readCanvas } from "@/lib/canvas/textSyntax";
import { blockWords } from "@/lib/canvas/textSyntax/relations";
import { boxOf, type Box } from "@/lib/canvas/textSyntax/segment";
import { planMatrixReduction, type Slip } from "@/e2e/support/matrixPlan";
import { makeJitter, writeText } from "@/e2e/support/strokeFont";
import { planElements } from "../canvas-syntax/fixtures";

export type BoardName = "clean" | "jitter1" | "jitter2";
export const BOARDS: BoardName[] = ["clean", "jitter1", "jitter2"];
const SEEDS: Record<BoardName, number | undefined> = { clean: undefined, jitter1: 1, jitter2: 2 };

export type PlantedError = {
  id: "matrix" | "line";
  /** The pen strokes written for the wrong value, and their box. */
  strokeIds: string[];
  box: Box;
  written: string;
  correct: string;
  /** Where the read puts it. */
  address: string;
  /** In plain English, for the report. */
  what: string;
};

export type AnnotateBoard = { name: BoardName; jitterSeed: number | null; elements: CanvasElement[]; errors: PlantedError[] };

/** M8 row 1 col 4: R1 = R1 - R2 takes 3 - 2 = 1; written as 5. */
const SLIP: Slip = { step: 7, row: 0, col: 3, value: 5 };
const SLIP_CORRECT = "1";
const LINE = { text: "2 + 2 = 5", x: 1330, y: 140, size: 30, word: 4, correct: "4" };

/** The address the read gives the cell or word made of exactly these strokes. */
function addressOf(elements: CanvasElement[], strokeIds: string[]): string {
  const want = [...strokeIds].sort().join(",");
  for (const b of readCanvas(elements, { render: "raw" }).doc.handwriting.blocks) {
    const places = b.kind === "matrix"
      ? b.rows.flatMap((row, r) => row.cells.map((w, c) => ({ w, address: `${b.id} row ${r + 1} col ${c + 1}` })))
      : blockWords(b).map((w, i) => ({ w, address: `${b.id} word ${i + 1}` }));
    const hit = places.find(({ w }) => w && w.glyphs.flatMap((g) => g.strokes.map((s) => s.id)).sort().join(",") === want);
    if (hit) return hit.address;
  }
  throw new Error(`canvas-annotate fixtures: the read has no cell or word made of exactly ${want}`);
}

export function makeBoard(name: BoardName): AnnotateBoard {
  const seed = SEEDS[name];
  const plan = planMatrixReduction({ jitterSeed: seed, slip: SLIP });
  const line = writeText(LINE.text, LINE.x, LINE.y, LINE.size, seed === undefined ? undefined : makeJitter(seed + 1000));
  const lineStrokes = line.glyphs.flatMap((g) => g.strokes.map((stroke) => ({ stroke, word: g.word })));
  const elements = planElements({ strokes: [...plan.strokes, ...lineStrokes.map((s) => s.stroke)] });
  const pointsOf = (ids: string[]) => elements.flatMap((e) => (ids.includes(e.id) && e.type === "draw" ? e.props.points.map((p) => ({ x: e.x + p.x, y: e.y + p.y })) : []));

  const slipIds = plan.meta.flatMap((m, i) => (m.role === "glyph" && m.step === SLIP.step && m.place.kind === "cell"
    && m.place.row === SLIP.row && m.place.col === SLIP.col ? [`s${i}`] : []));
  const lineIds = lineStrokes.flatMap((s, i) => (s.word === LINE.word ? [`s${plan.strokes.length + i}`] : []));
  const planted = (id: PlantedError["id"], strokeIds: string[], written: string, correct: string, what: string): PlantedError => {
    const address = addressOf(elements, strokeIds);
    return { id, strokeIds, box: boxOf(pointsOf(strokeIds)), written, correct, address, what: `${address}: ${what}` };
  };
  return {
    name, jitterSeed: seed ?? null, elements,
    errors: [
      planted("matrix", slipIds, String(SLIP.value), SLIP_CORRECT, `the last step's R1 = R1 - R2 gives 3 - 2 = ${SLIP_CORRECT}, but ${SLIP.value} is written`),
      planted("line", lineIds, "5", LINE.correct, `"${LINE.text}" — should be ${LINE.correct}`),
    ],
  };
}
