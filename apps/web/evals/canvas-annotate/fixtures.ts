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
 * A fourth board, "typed", has the same kind of mistakes typed instead: a
 * text box reading "this is a test: 3 + 4 = 7 and 2+2=5", a sticky note with
 * a right sum, and two math elements, "6 \times 7 = 42" and the wrong
 * "12 \div 4 = 4" — words of typed text and LaTeX being named by place too
 * ("X1 word 11", "Q2 word 5").
 *
 * Ground truth per planted error: the stroke ids written for it (for typed
 * text, its element's id), their box, what was written and what is right,
 * and its address in the read ("M8 row 1 col 4", "T8 word 5", "X1 word 11").
 */
import type { CanvasElement } from "@mola/shared";
import { readCanvas } from "@/lib/canvas/textSyntax";
import { blockWords } from "@/lib/canvas/textSyntax/relations";
import { boxOf, type Box } from "@/lib/canvas/textSyntax/segment";
import { planMatrixReduction, type Slip } from "@/e2e/support/matrixPlan";
import { makeJitter, writeText } from "@/e2e/support/strokeFont";
import { planElements } from "../canvas-syntax/fixtures";
import { math, note, textBox } from "../canvas-reader/fixtures";

export type BoardName = "clean" | "jitter1" | "jitter2" | "typed";
export const BOARDS: BoardName[] = ["clean", "jitter1", "jitter2", "typed"];
const SEEDS: Record<Exclude<BoardName, "typed">, number | undefined> = { clean: undefined, jitter1: 1, jitter2: 2 };

export type PlantedError = {
  id: "matrix" | "line" | "typed" | "math";
  /** The pen strokes written for the wrong value, and their box; for typed text, its element. */
  strokeIds: string[];
  box: Box;
  written: string;
  correct: string;
  /** Where the read puts it. */
  address: string;
  /** In plain English, for the report. */
  what: string;
  /** Typed text: pinpointed only by an annotation on this address, its word — on the element, every annotation is. */
  byAddress?: true;
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

/** The typed board: its text and math, and which word of each is the mistake. */
const TYPED = {
  text: { id: "typed-text", text: "this is a test: 3 + 4 = 7 and 2+2=5", word: 11, correct: "4" },
  note: { id: "typed-note", text: "Remember: 10 - 3 = 7" },
  right: { id: "typed-math-right", latex: "6 \\times 7 = 42" },
  wrong: { id: "typed-math-wrong", latex: "12 \\div 4 = 4", word: 5, correct: "3" },
};

function typedBoard(): AnnotateBoard {
  const { text, note: sticky, right, wrong } = TYPED;
  const elements = [
    textBox(text.id, 300, 120, text.text, { width: 380 }),
    note(sticky.id, 760, 120, sticky.text),
    math(right.id, 300, 220, right.latex),
    math(wrong.id, 300, 300, wrong.latex),
  ];
  const label = (id: string) => readCanvas(elements).doc.items.find((i) => i.elementIds.includes(id))!.label;
  const planted = (id: PlantedError["id"], elementId: string, word: number, written: string, correct: string, what: string): PlantedError => {
    const e = elements.find((x) => x.id === elementId)!;
    const address = `${label(elementId)} word ${word}`;
    return {
      id, strokeIds: [elementId], box: { minX: e.x, minY: e.y, maxX: e.x + e.width, maxY: e.y + e.height }, written, correct, address,
      what: `${address}: ${what}`, byAddress: true,
    };
  };
  return {
    name: "typed", jitterSeed: null, elements,
    errors: [
      planted("typed", text.id, text.word, "2+2=5", text.correct, `"2+2=5" in a typed sentence — should be ${text.correct}`),
      planted("math", wrong.id, wrong.word, "4", wrong.correct, `"${wrong.latex}" in LaTeX — should be ${wrong.correct}`),
    ],
  };
}

export function makeBoard(name: BoardName): AnnotateBoard {
  if (name === "typed") return typedBoard();
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
