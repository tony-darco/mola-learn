/**
 * Handwritten blocks (segment.ts) as text, one of two ways:
 *
 *   "raw"        — every character as a small ASCII bitmap (bitmap.ts), for
 *                  the model to read itself;
 *   "normalized" — every character read by the recognizer (recognize.ts),
 *                  matrices as bracketed rows and text as strings; a
 *                  character it is unsure of is printed in place as the
 *                  readings it offers, "«5|S|s»".
 *
 * A block can also be rendered in part — only some of its cells or words —
 * for a read of a selected region that cuts through it.
 */
import { renderWord } from "./bitmap";
import { offered, recognizeDoc, type Recognition, type Script } from "./recognize";
import type { Block, Box, Glyph, HandwritingDoc, MatrixBlock, TextBlock, Word } from "./segment";

/**
 * A word's characters with its scripts marked, as in LaTeX: "H_2O", "x^2",
 * and braces round a run of more than one character, "x^{10}" — an unsure
 * one counting as one, "C_«2|z»".
 */
export function scriptedText(chars: { char: string; script?: Script | null }[]): string {
  let out = "";
  for (let i = 0; i < chars.length;) {
    const script = chars[i]!.script ?? null;
    let j = i + 1;
    while (j < chars.length && (chars[j]!.script ?? null) === script) j++;
    const run = chars.slice(i, j).map((c) => c.char).join("");
    out += !script ? run : `${script === "sub" ? "_" : "^"}${j - i === 1 ? run : `{${run}}`}`;
    i = j;
  }
  return out;
}

/**
 * An unsure character as printed: what it may be, most likely first, between
 * guillemets — "«5|S|s»". Neither "«", "»" nor "|" is ever a reading, and
 * none of them means anything in math, so the mark can't be taken for writing.
 */
export const unsureText = (readings: string[]) => `«${readings.join("|")}»`;

/** A character whose likeliest reading scores below this (the scores of all its readings summing to 1) is barely legible. */
const ILLEGIBLE = 0.2;

/** Characters printed, and of those, how many were unsure and how many barely legible. */
export type Tally = { chars: number; unsure: number; illegible: number };

/**
 * A word as a normalized read prints it: each character as recognized, with
 * scripts marked (scriptedText), and each one the recognizer is less sure of
 * than `minConfidence` as the readings it offers (recognize.ts's offered),
 * "1«0|θ|O»0". `tally`, if given, is added to.
 */
export function printedWord(w: Word, reads: Map<Glyph, Recognition>, minConfidence: number, tally?: Tally): string {
  const rs = w.glyphs.map((g) => reads.get(g)!);
  return scriptedText(rs.map((r, i) => {
    if (tally) tally.chars++;
    if (r.confidence >= minConfidence) return r;
    if (tally) {
      tally.unsure++;
      if (r.candidates[0]!.score < ILLEGIBLE) tally.illegible++;
    }
    return { char: unsureText(offered(w.glyphs[i]!, rs, i)), script: r.script };
  }));
}

/** Most of a block's characters barely legible: said once, after its kind, so its readings are taken as guesses. */
const hardToRead = (t: Tally) => (2 * t.illegible > t.chars ? ", hard to read: the recognizer is unsure of most of its characters" : "");

export type SyntaxRender = "raw" | "normalized";

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
export const topLeft = (b: Box) => `(${Math.round(b.minX)}, ${Math.round(b.minY)})`;
/** "words 2–4" for a run, "word 2" for one. */
export const span = (noun: string, from: number, to: number) => (from === to ? `${noun} ${from}` : `${noun}s ${from}–${to}`);

function barPlace(afterColumn: number, columns: number): string {
  if (afterColumn <= 0) return "before column 1";
  if (afterColumn >= columns) return `after column ${columns}`;
  return `between columns ${afterColumn} and ${afterColumn + 1}`;
}

/** `tag` follows the kind, e.g. " (made by the AI)"; `note` ends the description, e.g. ", hard to read: …". */
export function describeMatrix(m: MatrixBlock, tag = "", note = ""): string {
  const bars = m.bars.map((b) => barPlace(b.afterColumn, m.columns));
  const barText = bars.length === 0 ? ""
    : bars.length === 1 ? `, with a vertical bar ${bars[0]}`
    : `, with vertical bars ${bars.join(" and ")}`;
  const size = `${Math.round(m.box.maxX - m.box.minX)} x ${Math.round(m.box.maxY - m.box.minY)}`;
  return `${m.id} — matrix in brackets${tag}, ${plural(m.rows.length, "row", "rows")} x ${plural(m.columns, "column", "columns")}${barText}${note}. Top-left ${topLeft(m.box)}, size ${size}.`;
}

/** `operands`: for the operators written between matrices (TextBlock.operands), those matrices' labels. `note`, as in describeMatrix. */
export const describeText = (t: TextBlock, tag = "", operands?: string[], note = "") => (operands
  ? `${t.id} — operators written between matrices${tag}, joining ${operands.slice(0, -1).join(", ")} and ${operands[operands.length - 1]} into one expression${note}. Top-left ${topLeft(t.box)}.`
  : `${t.id} — line of text${tag}, ${plural(t.words.length, "word", "words")}${note}. Top-left ${topLeft(t.box)}.`);

/** Matrices' labels with the operators between them: "M1 × M2 = M3". */
const expression = (operands: string[], operators: string[]) => operands.flatMap((m, i) => (i < operators.length ? [m, operators[i]!] : [m])).join(" ");

/** The labels of the matrices a block of operators joins, as `doc` names them; undefined for any other block. */
const operandLabels = (doc: HandwritingDoc, t: TextBlock) =>
  t.operands?.map((left) => doc.blocks.find((b) => b.kind === "matrix" && b.delimiters.left === left)?.id ?? "a matrix");

/** How an unsure character is printed (unsureText), as a guide bullet. */
export const UNSURE_GUIDE = `- A handwritten character the recognizer is unsure of is printed where it was written as what it may be, most likely first, `
  + `between « and » and separated by "|": "x = «5|S|s»" means the x equals a 5, an S or an s. «, » and | are never part of the writing itself.`;

/** How to read the handwriting, as guide bullets. */
export const HANDWRITING_GUIDE: Record<SyntaxRender, (rows: number) => string[]> = {
  raw: (rows) => [
    `- Every handwritten character is a small bitmap: "#" is ink, "." is blank paper.`,
    `- All bitmaps on one line of writing share the same ${rows} rows, top to bottom, so marks keep their size and height: a minus sign is a short run of "#" in the middle rows, "=" is two short runs.`,
    "- A cell or word with several characters shows their bitmaps side by side, one space column apart.",
  ],
  normalized: () => [
    "- Every handwritten character has been read from its pen strokes by a shape recognizer.",
    `- A matrix is printed row by row between square brackets, with "|" where a vertical bar is drawn and "_" for an empty cell. A line of text is printed after its id, with single spaces between words.`,
    `- Subscripts and superscripts are marked as in LaTeX: "H_2O" has a subscript 2, "x^2" a superscript 2, and braces group several characters, "x^{10}".`,
    UNSURE_GUIDE,
  ],
};
export const COORDINATES = "- Coordinates are canvas units: x grows rightward, y grows downward.";
export const BOXES_GUIDE = `- After each matrix and line of handwriting comes the box of every cell or word in it, by its top-left and bottom-right corners: "M1 row 2 col 3: (310, 150) to (330, 180)".`;

/** A box rounded outward to whole canvas units: what is printed, so a printed point inside it is inside. */
export const outward = (b: Box): Box => ({ minX: Math.floor(b.minX), minY: Math.floor(b.minY), maxX: Math.ceil(b.maxX), maxY: Math.ceil(b.maxY) });

/** Every cell's or word's box, one per line under its address; `only`, as in BlockExtras. Empty cells have none. */
export function describeBoxes(block: Block, only?: Set<Word>): string {
  const places = block.kind === "matrix"
    ? block.rows.flatMap((row, r) => row.cells.map((w, c) => ({ w, address: `${block.id} row ${r + 1} col ${c + 1}` })))
    : block.words.map((w, i) => ({ w, address: `${block.id} word ${i + 1}` }));
  const lines = places.flatMap(({ w, address }) => {
    if (!w || (only && !only.has(w))) return [];
    const b = outward(w.box);
    return [`${address}: (${b.minX}, ${b.minY}) to (${b.maxX}, ${b.maxY})`];
  });
  return [`Boxes of the ${block.kind === "matrix" ? "cells" : "words"} of ${block.id}:`, ...lines].join("\n");
}

export const RAW_GUIDE = (rows: number) => ["How to read it:", ...HANDWRITING_GUIDE.raw(rows), COORDINATES].join("\n");
export const NORMALIZED_GUIDE = (rows: number) => ["How to read it:", ...HANDWRITING_GUIDE.normalized(rows), COORDINATES].join("\n");

const PARTLY = {
  matrix: " Partly inside the selection; only the selected cells are listed.",
  text: " Partly inside the selection; only the selected words are listed.",
};

export type BlockExtras = {
  /** Follows the block's kind in its description, e.g. " (made by the AI)". */
  tag?: string;
  /** Only these cells or words — for a block the selection cuts through. */
  only?: Set<Word>;
};

/**
 * A renderer for the blocks of one document. Each call returns one block's
 * text (in a raw render, sections separated by blank lines). `reads`: the
 * recognizer's readings, if already made (of a document holding these blocks
 * and maybe more).
 */
export function blockRenderer(
  doc: HandwritingDoc, opts: { render: SyntaxRender; rows: number; minConfidence: number; reads?: Map<Glyph, Recognition> },
): (block: Block, extras?: BlockExtras) => string {
  const { rows } = opts;
  return opts.render === "raw" ? rawBlock(doc, rows) : normalizedBlock(doc, opts.reads ?? recognizeDoc(doc), opts.minConfidence);
}

// ── raw: every character as a bitmap ────────────────────────────────────────

const rawBlock = (doc: HandwritingDoc, rows: number) => (block: Block, { tag = "", only }: BlockExtras = {}): string => {
  const shown = (w: Word | null): w is Word => !!w && (!only || only.has(w));
  if (block.kind === "text") {
    const operands = operandLabels(doc, block);
    return [
      describeText(block, tag, operands) + (only ? PARTLY.text : "")
        + (operands && !only ? `\n${block.id}: ${expression(operands, block.words.map((_, i) => `(word ${i + 1})`))}` : ""),
      ...block.words.flatMap((w, i) => (shown(w) ? [`${block.id} word ${i + 1}\n${renderWord(w, block.box, rows).join("\n")}`] : [])),
    ].join("\n\n");
  }
  return [
    describeMatrix(block, tag) + (only ? PARTLY.matrix : ""),
    ...block.rows.flatMap((row, r) => row.cells.flatMap((cell, c) => {
      if (only && !shown(cell)) return [];
      const body = cell ? renderWord(cell, row.box, rows).join("\n") : "(empty)";
      return [`${block.id} row ${r + 1} col ${c + 1}\n${body}`];
    })),
  ].join("\n\n");
};

// ── normalized: every character as recognized ──────────────────────────────

function normalizedBlock(doc: HandwritingDoc, reads: Map<Glyph, Recognition>, minConfidence: number) {
  return (block: Block, { tag = "", only }: BlockExtras = {}): string => {
    // Every character printed, so the description can say if most were barely legible.
    const tally: Tally = { chars: 0, unsure: 0, illegible: 0 };
    const read = (w: Word) => printedWord(w, reads, minConfidence, tally);

    if (block.kind === "text") {
      const operands = operandLabels(doc, block);
      if (!only) {
        const words = block.words.map(read);
        return `${describeText(block, tag, operands, hardToRead(tally))}\n${block.id}: ${operands ? expression(operands, words) : words.join(" ")}`;
      }
      // Runs of consecutive selected words, under their addresses.
      const lines: string[] = [];
      let run: number[] = [];
      const flush = () => {
        if (run.length) lines.push(`${block.id} ${span("word", run[0]! + 1, run[run.length - 1]! + 1)}: ${run.map((i) => read(block.words[i]!)).join(" ")}`);
        run = [];
      };
      block.words.forEach((w, i) => (only.has(w) ? run.push(i) : flush()));
      flush();
      return [describeText(block, tag, operands, hardToRead(tally)) + PARTLY.text, ...lines].join("\n");
    }

    // In part, a row with every entry selected is printed whole; otherwise only its selected cells are read.
    const wholeRow = block.rows.map((row) => !only || (row.cells.some((c) => c) && row.cells.every((c) => !c || only.has(c))));
    const cells = block.rows.map((row, r) => row.cells.map((c) => {
      if (!wholeRow[r] && !(c && only?.has(c))) return null;
      return c ? read(c) : "_";
    }));
    const widths = Array.from({ length: block.columns }, (_, c) => Math.max(2, ...cells.map((r) => r[c]?.length ?? 0)));
    // A bar sits before column `c` (0-based) when its afterColumn is c; one past the last column closes the row.
    const barAt = (c: number) => block.bars.some((b) => Math.min(Math.max(b.afterColumn, 0), block.columns) === c);
    const rowText = (r: (string | null)[]) => {
      const parts = [...(barAt(0) ? ["|"] : []), ...r.flatMap((v, c) => [v!.padStart(widths[c]!), ...(barAt(c + 1) ? ["|"] : [])])];
      return `[ ${parts.join(" ")} ]`;
    };
    if (!only) return [describeMatrix(block, tag, hardToRead(tally)), ...cells.map(rowText)].join("\n");

    const lines = cells.flatMap((row, r) => (wholeRow[r]
      ? [`${block.id} row ${r + 1}: ${rowText(row)}`]
      : row.flatMap((v, c) => (v === null ? [] : [`${block.id} row ${r + 1} col ${c + 1}: ${v}`]))));
    return [describeMatrix(block, tag, hardToRead(tally)) + PARTLY.matrix, ...lines].join("\n");
  };
}
