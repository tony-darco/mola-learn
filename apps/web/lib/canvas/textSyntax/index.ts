/**
 * Canvas handwriting → plain text a language model can read without images.
 * Pen strokes are segmented into matrices and lines of text (segment.ts),
 * then rendered raw or normalized (handwriting.ts).
 *
 * For everything else on the canvas as well — typed text, shapes, arrows,
 * frames, pen marks and drawings, and what they point at — see readCanvas
 * (read.ts).
 *
 * The output explains its own format, since it is meant to be handed to a
 * model verbatim. Deterministic: the same elements always give the
 * identical string.
 */
import type { CanvasElement } from "@mola/shared";
import { DEFAULT_BITMAP_ROWS } from "./bitmap";
import { blockRenderer, NORMALIZED_GUIDE, plural, RAW_GUIDE, type SyntaxRender } from "./handwriting";
import { DEFAULT_MIN_CONFIDENCE } from "./recognize";
import { inkFromElements, segmentHandwriting, type HandwritingDoc } from "./segment";

export type { SyntaxRender } from "./handwriting";
export { readCanvas, type CanvasDoc, type ReadItem, type Region } from "./read";
export { EMPTY_LABELS, type LabelMap } from "./labels";

export function canvasHandwritingToText(
  elements: CanvasElement[],
  opts: { render?: SyntaxRender; bitmapRows?: number; minConfidence?: number } = {},
): { text: string; doc: HandwritingDoc } {
  const render = opts.render ?? "raw";
  const rows = opts.bitmapRows ?? DEFAULT_BITMAP_ROWS;
  const doc = segmentHandwriting(inkFromElements(elements));
  const header = "HANDWRITING ON THIS CANVAS, AS TEXT";
  if (doc.blocks.length === 0) return { text: `${header}\nNo handwriting found.`, doc };

  const matrices = doc.blocks.filter((b) => b.kind === "matrix").length;
  const lines = doc.blocks.length - matrices;
  const intro = [
    header,
    `${plural(matrices, "matrix", "matrices")} and ${plural(lines, "line", "lines")} of text, in reading order (top to bottom within each column of the board, columns left to right).`,
  ].join("\n");
  const guide = render === "normalized" ? NORMALIZED_GUIDE(rows) : RAW_GUIDE(rows);
  const renderBlock = blockRenderer(doc, { render, rows, minConfidence: opts.minConfidence ?? DEFAULT_MIN_CONFIDENCE });
  return { text: [intro, guide, ...doc.blocks.map((b) => renderBlock(b))].join("\n\n"), doc };
}
