/**
 * Scoring for the canvas-reader eval.
 *
 * Reader checks — did the reader find exactly the pen marks on the board,
 * leave the handwriting as the canvas-syntax eval expects it, and say the
 * right thing about every mark, connector and frame? No model involved.
 *
 * QA — did a model, given the read, answer each question right? See
 * questions.ts.
 */
import type { CanvasDoc, ReadItem } from "@/lib/canvas/textSyntax/read";
import { inkFromElements, segmentHandwriting, type HandwritingDoc, type Word } from "@/lib/canvas/textSyntax/segment";
import { planElements } from "../canvas-syntax/fixtures";
import { scoreStageA } from "../canvas-syntax/score";
import type { BoardFixture, Expected } from "./fixtures";

export type Check = { name: string; expected: string; got: string; pass: boolean };

/** Every block's id and structure, down to which strokes make each glyph. */
function blocksShape(doc: HandwritingDoc) {
  const word = (w: Word | null) => w?.glyphs.map((g) => g.strokes.map((s) => s.id).sort().join("+")) ?? null;
  return doc.blocks.map((b) => (b.kind === "matrix"
    ? [b.id, b.delimiters.left.id, b.delimiters.right.id, b.bars.map((x) => `${x.ink.id}@${x.afterColumn}`), b.rows.map((r) => r.cells.map(word))]
    : [b.id, b.words.map(word)]));
}

const ends = (e: [string | null, string | null]) => `from ${e[0] ?? "a free end"} to ${e[1] ?? "a free end"}`;

function describe(x: Pick<Expected, "kind" | "targets" | "ends" | "madeByAI">, only: Expected): string {
  return [
    x.kind,
    ...(only.targets ? [`→ ${(x.targets ?? []).join(", ") || "nothing"}`] : []),
    ...(only.ends ? [x.ends ? ends(x.ends) : "no ends"] : []),
    ...(only.madeByAI !== undefined ? [x.madeByAI === true ? "made by the AI" : x.madeByAI === "partly" ? "partly made by the AI" : "made by the user"] : []),
  ].join(" ");
}

export function checkBoard(board: BoardFixture, doc: CanvasDoc): Check[] {
  const checks: Check[] = [];

  // The marks must not touch the handwriting: it segments exactly as it does with nothing else on the board
  // (which is the canvas-syntax eval's business to get right), blocks labelled in reading order.
  const alone = segmentHandwriting(inkFromElements(planElements(board.plan)));
  const { metrics } = scoreStageA(board.plan, doc.handwriting);
  const same = JSON.stringify(blocksShape(doc.handwriting)) === JSON.stringify(blocksShape(alone));
  checks.push({
    name: "handwriting unaffected by the marks",
    expected: `segmented as with no marks on the board: ${alone.blocks.map((b) => b.id).join(" ")}`,
    got: `${same ? "identical" : "DIFFERENT"}: ${doc.handwriting.blocks.map((b) => b.id).join(" ")}; against what was written, matrices ${metrics.matrices.matched}/${metrics.matrices.expected}, `
      + `cells ${metrics.cells.correct}/${metrics.cells.expected}, glyphs ${metrics.glyphs.correct}/${metrics.glyphs.expected}, labels ${metrics.texts.correct}/${metrics.texts.expected}`,
    pass: same,
  });

  const markKey = (kind: string, ids: string[]) => `${kind} [${[...ids].sort().join(", ")}]`;
  const penMarks = doc.items.filter((i) => i.pen && (i.kind === "circle" || i.kind === "arrow" || i.kind === "underline"));
  const expectedMarks = board.truth.marks.map((m) => markKey(m.kind, m.ids)).sort();
  const gotMarks = penMarks.map((m) => markKey(m.kind, m.elementIds)).sort();
  checks.push({ name: "pen marks found", expected: expectedMarks.join("; "), got: gotMarks.join("; ") || "none", pass: expectedMarks.join("; ") === gotMarks.join("; ") });

  for (const want of board.truth.items) {
    const item: ReadItem | undefined = doc.items.find((i) => i.elementIds.includes(want.id));
    const expected = describe(want, want);
    const got = item ? `${item.label}: ${describe(item, want)}` : "not found";
    checks.push({ name: want.id, expected, got, pass: !!item && describe(item, want) === expected });
  }
  return checks;
}
