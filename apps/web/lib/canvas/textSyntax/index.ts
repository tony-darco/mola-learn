/**
 * Canvas handwriting → plain text a language model can read without images.
 * Pen strokes are segmented into matrices and lines of text (segment.ts),
 * then rendered one of two ways:
 *
 *   "raw"        — every character as a small ASCII bitmap (bitmap.ts), for
 *                  the model to read itself;
 *   "normalized" — every character read by the recognizer (recognize.ts),
 *                  matrices as bracketed rows and text as strings; only the
 *                  characters it is unsure of fall back to bitmaps.
 *
 * The output explains its own format, since it is meant to be handed to a
 * model verbatim. Deterministic: the same elements always give the
 * identical string.
 */
import type { CanvasElement } from "@mola/shared";
import { DEFAULT_BITMAP_ROWS, renderWord } from "./bitmap";
import { DEFAULT_MIN_CONFIDENCE, recognizeDoc } from "./recognize";
import { inkFromElements, segmentHandwriting, type Box, type HandwritingDoc, type MatrixBlock, type TextBlock, type Word } from "./segment";

export type SyntaxRender = "raw" | "normalized";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const topLeft = (b: Box) => `(${Math.round(b.minX)}, ${Math.round(b.minY)})`;

function barPlace(afterColumn: number, columns: number): string {
  if (afterColumn <= 0) return "before column 1";
  if (afterColumn >= columns) return `after column ${columns}`;
  return `between columns ${afterColumn} and ${afterColumn + 1}`;
}

function describeMatrix(m: MatrixBlock): string {
  const bars = m.bars.map((b) => barPlace(b.afterColumn, m.columns));
  const barText = bars.length === 0 ? ""
    : bars.length === 1 ? `, with a vertical bar ${bars[0]}`
    : `, with vertical bars ${bars.join(" and ")}`;
  const size = `${Math.round(m.box.maxX - m.box.minX)} x ${Math.round(m.box.maxY - m.box.minY)}`;
  return `${m.id} — matrix in brackets, ${plural(m.rows.length, "row", "rows")} x ${plural(m.columns, "column", "columns")}${barText}. Top-left ${topLeft(m.box)}, size ${size}.`;
}

const describeText = (t: TextBlock) => `${t.id} — line of text, ${plural(t.words.length, "word", "words")}. Top-left ${topLeft(t.box)}.`;

// ── raw: every character as a bitmap ────────────────────────────────────────

function matrixSections(m: MatrixBlock, rows: number): string[] {
  return [
    describeMatrix(m),
    ...m.rows.flatMap((row, r) => row.cells.map((cell, c) => {
      const body = cell ? renderWord(cell, row.box, rows).join("\n") : "(empty)";
      return `${m.id} row ${r + 1} col ${c + 1}\n${body}`;
    })),
  ];
}

function textSections(t: TextBlock, rows: number): string[] {
  return [
    describeText(t),
    ...t.words.map((w, i) => `${t.id} word ${i + 1}\n${renderWord(w, t.box, rows).join("\n")}`),
  ];
}

const RAW_GUIDE = (rows: number) => [
  "How to read it:",
  `- Every handwritten character is a small bitmap: "#" is ink, "." is blank paper.`,
  `- All bitmaps on one line of writing share the same ${rows} rows, top to bottom, so marks keep their size and height: a minus sign is a short run of "#" in the middle rows, "=" is two short runs.`,
  "- A cell or word with several characters shows their bitmaps side by side, one space column apart.",
  "- Coordinates are canvas units: x grows rightward, y grows downward.",
].join("\n");

// ── normalized: every character as recognized ──────────────────────────────

const NORMALIZED_GUIDE = (rows: number) => [
  "How to read it:",
  "- Every handwritten character has been read from its pen strokes by a shape recognizer.",
  `- A matrix is printed row by row between square brackets, with "|" where a vertical bar is drawn and "_" for an empty cell. A line of text is printed after its id, with single spaces between words.`,
  `- A character the recognizer is unsure of is printed as ?g<n>. Under its matrix or line, g<n> lists its likeliest readings with their scores, then shows it as a bitmap: "#" is ink, "." is blank paper, on the same ${rows} rows as the rest of its line, so marks keep their size and height (a minus sign is a short run of "#" in the middle rows).`,
  "- Coordinates are canvas units: x grows rightward, y grows downward.",
].join("\n");

function normalizedSections(doc: HandwritingDoc, rows: number, minConfidence: number): string[] {
  const reads = recognizeDoc(doc);
  let uncertain = 0;
  return doc.blocks.flatMap((block) => {
    const legend: string[] = [];
    const read = (w: Word, band: Box) => w.glyphs.map((g) => {
      const r = reads.get(g)!;
      if (r.confidence >= minConfidence) return r.char;
      const id = `g${++uncertain}`;
      const options = r.candidates.slice(0, 3).map((c) => `${c.char} (${c.score.toFixed(2)})`);
      const readings = options.length > 1 ? `${options.slice(0, -1).join(", ")} or ${options[options.length - 1]}` : options[0];
      legend.push(`${id}: ${readings}\n${renderWord({ glyphs: [g], box: g.box }, band, rows).join("\n")}`);
      return `?${id}`;
    }).join("");

    if (block.kind === "text") return [`${describeText(block)}\n${block.id}: ${block.words.map((w) => read(w, block.box)).join(" ")}`, ...legend];

    const cells = block.rows.map((row) => row.cells.map((c) => (c ? read(c, row.box) : "_")));
    const widths = Array.from({ length: block.columns }, (_, c) => Math.max(2, ...cells.map((r) => r[c]!.length)));
    // A bar sits before column `c` (0-based) when its afterColumn is c; one past the last column closes the row.
    const barAt = (c: number) => block.bars.some((b) => Math.min(Math.max(b.afterColumn, 0), block.columns) === c);
    const lines = cells.map((r) => {
      const parts = [...(barAt(0) ? ["|"] : []), ...r.flatMap((v, c) => [v.padStart(widths[c]!), ...(barAt(c + 1) ? ["|"] : [])])];
      return `[ ${parts.join(" ")} ]`;
    });
    return [[describeMatrix(block), ...lines].join("\n"), ...legend];
  });
}

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
  const [guide, sections] = render === "normalized"
    ? [NORMALIZED_GUIDE(rows), normalizedSections(doc, rows, opts.minConfidence ?? DEFAULT_MIN_CONFIDENCE)]
    : [RAW_GUIDE(rows), doc.blocks.flatMap((b) => (b.kind === "matrix" ? matrixSections(b, rows) : textSections(b, rows)))];
  return { text: [intro, guide, ...sections].join("\n\n"), doc };
}
