/**
 * Handwritten blocks (segment.ts) as text, one of two ways:
 *
 *   "raw"        — every character as a small ASCII bitmap (bitmap.ts), for
 *                  the model to read itself;
 *   "normalized" — every character read by the recognizer (recognize.ts),
 *                  matrices as bracketed rows and text as strings; only the
 *                  characters it is unsure of fall back to bitmaps.
 *
 * A block can also be rendered in part — only some of its cells or words —
 * for a read of a selected region that cuts through it.
 */
import { renderWord } from "./bitmap";
import { recognizeDoc, type Script } from "./recognize";
import type { Block, Box, HandwritingDoc, MatrixBlock, TextBlock, Word } from "./segment";

/**
 * A word's characters with its scripts marked, as in LaTeX: "H_2O", "x^2",
 * and braces round a run of more than one character, "x^{10}", "C_{?g1}".
 */
export function scriptedText(chars: { char: string; script?: Script | null }[]): string {
  let out = "";
  for (let i = 0; i < chars.length;) {
    const script = chars[i]!.script ?? null;
    let j = i + 1;
    while (j < chars.length && (chars[j]!.script ?? null) === script) j++;
    const run = chars.slice(i, j).map((c) => c.char).join("");
    out += !script ? run : `${script === "sub" ? "_" : "^"}${[...run].length === 1 ? run : `{${run}}`}`;
    i = j;
  }
  return out;
}

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

/** `tag` follows the kind, e.g. " (made by the AI)". */
export function describeMatrix(m: MatrixBlock, tag = ""): string {
  const bars = m.bars.map((b) => barPlace(b.afterColumn, m.columns));
  const barText = bars.length === 0 ? ""
    : bars.length === 1 ? `, with a vertical bar ${bars[0]}`
    : `, with vertical bars ${bars.join(" and ")}`;
  const size = `${Math.round(m.box.maxX - m.box.minX)} x ${Math.round(m.box.maxY - m.box.minY)}`;
  return `${m.id} — matrix in brackets${tag}, ${plural(m.rows.length, "row", "rows")} x ${plural(m.columns, "column", "columns")}${barText}. Top-left ${topLeft(m.box)}, size ${size}.`;
}

export const describeText = (t: TextBlock, tag = "") => `${t.id} — line of text${tag}, ${plural(t.words.length, "word", "words")}. Top-left ${topLeft(t.box)}.`;

/** How to read the handwriting, as guide bullets. */
export const HANDWRITING_GUIDE: Record<SyntaxRender, (rows: number) => string[]> = {
  raw: (rows) => [
    `- Every handwritten character is a small bitmap: "#" is ink, "." is blank paper.`,
    `- All bitmaps on one line of writing share the same ${rows} rows, top to bottom, so marks keep their size and height: a minus sign is a short run of "#" in the middle rows, "=" is two short runs.`,
    "- A cell or word with several characters shows their bitmaps side by side, one space column apart.",
  ],
  normalized: (rows) => [
    "- Every handwritten character has been read from its pen strokes by a shape recognizer.",
    `- A matrix is printed row by row between square brackets, with "|" where a vertical bar is drawn and "_" for an empty cell. A line of text is printed after its id, with single spaces between words.`,
    `- Subscripts and superscripts are marked as in LaTeX: "H_2O" has a subscript 2, "x^2" a superscript 2, and braces group several characters, "x^{10}".`,
    `- A character the recognizer is unsure of is printed as ?g<n>. Under its matrix or line, g<n> lists its likeliest readings with their scores, then shows it as a bitmap: "#" is ink, "." is blank paper, on the same ${rows} rows as the rest of its line, so marks keep their size and height (a minus sign is a short run of "#" in the middle rows).`,
  ],
};
export const COORDINATES = "- Coordinates are canvas units: x grows rightward, y grows downward.";

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
 * A renderer for the blocks of one document. Uncertain characters are
 * numbered g1, g2, … across the whole document, in the order its blocks are
 * rendered. Each call returns one block's text, sections separated by blank
 * lines.
 */
export function blockRenderer(
  doc: HandwritingDoc, opts: { render: SyntaxRender; rows: number; minConfidence: number },
): (block: Block, extras?: BlockExtras) => string {
  const { rows } = opts;
  return opts.render === "raw" ? rawBlock(rows) : normalizedBlock(doc, rows, opts.minConfidence);
}

// ── raw: every character as a bitmap ────────────────────────────────────────

const rawBlock = (rows: number) => (block: Block, { tag = "", only }: BlockExtras = {}): string => {
  const shown = (w: Word | null): w is Word => !!w && (!only || only.has(w));
  if (block.kind === "text") {
    return [
      describeText(block, tag) + (only ? PARTLY.text : ""),
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

function normalizedBlock(doc: HandwritingDoc, rows: number, minConfidence: number) {
  const reads = recognizeDoc(doc);
  let uncertain = 0;
  return (block: Block, { tag = "", only }: BlockExtras = {}): string => {
    const legend: string[] = [];
    const read = (w: Word, band: Box) => scriptedText(w.glyphs.map((g) => {
      const r = reads.get(g)!;
      if (r.confidence >= minConfidence) return r;
      const id = `g${++uncertain}`;
      const options = r.candidates.slice(0, 3).map((c) => `${c.char} (${c.score.toFixed(2)})`);
      const readings = options.length > 1 ? `${options.slice(0, -1).join(", ")} or ${options[options.length - 1]}` : options[0];
      legend.push(`${id}: ${readings}\n${renderWord({ glyphs: [g], box: g.box }, band, rows).join("\n")}`);
      return { char: `?${id}`, script: r.script };
    }));

    if (block.kind === "text") {
      if (!only) return [`${describeText(block, tag)}\n${block.id}: ${block.words.map((w) => read(w, block.box)).join(" ")}`, ...legend].join("\n\n");
      // Runs of consecutive selected words, under their addresses.
      const lines: string[] = [];
      let run: number[] = [];
      const flush = () => {
        if (run.length) lines.push(`${block.id} ${span("word", run[0]! + 1, run[run.length - 1]! + 1)}: ${run.map((i) => read(block.words[i]!, block.box)).join(" ")}`);
        run = [];
      };
      block.words.forEach((w, i) => (only.has(w) ? run.push(i) : flush()));
      flush();
      return [[describeText(block, tag) + PARTLY.text, ...lines].join("\n"), ...legend].join("\n\n");
    }

    // In part, a row with every entry selected is printed whole; otherwise only its selected cells are read.
    const wholeRow = block.rows.map((row) => !only || (row.cells.some((c) => c) && row.cells.every((c) => !c || only.has(c))));
    const cells = block.rows.map((row, r) => row.cells.map((c) => {
      if (!wholeRow[r] && !(c && only?.has(c))) return null;
      return c ? read(c, row.box) : "_";
    }));
    const widths = Array.from({ length: block.columns }, (_, c) => Math.max(2, ...cells.map((r) => r[c]?.length ?? 0)));
    // A bar sits before column `c` (0-based) when its afterColumn is c; one past the last column closes the row.
    const barAt = (c: number) => block.bars.some((b) => Math.min(Math.max(b.afterColumn, 0), block.columns) === c);
    const rowText = (r: (string | null)[]) => {
      const parts = [...(barAt(0) ? ["|"] : []), ...r.flatMap((v, c) => [v!.padStart(widths[c]!), ...(barAt(c + 1) ? ["|"] : [])])];
      return `[ ${parts.join(" ")} ]`;
    };
    if (!only) return [[describeMatrix(block, tag), ...cells.map(rowText)].join("\n"), ...legend].join("\n\n");

    const lines = cells.flatMap((row, r) => (wholeRow[r]
      ? [`${block.id} row ${r + 1}: ${rowText(row)}`]
      : row.flatMap((v, c) => (v === null ? [] : [`${block.id} row ${r + 1} col ${c + 1}: ${v}`]))));
    return [[describeMatrix(block, tag) + PARTLY.matrix, ...lines].join("\n"), ...legend].join("\n\n");
  };
}
