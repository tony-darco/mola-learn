/**
 * What a model means when it points at something on the board: an address
 * from the read ("M4", "M4 row 2 col 3", "M4 row 2", "M4 col 3", "T1 word 5",
 * "T1 words 3–5", "N2"), or a point {x, y} in canvas units. Either resolves
 * to the canvas elements it covers — every pen stroke of a cell or word, a
 * placed element's id — and their box, or to an error the model can act on
 * ("no T9 on this canvas").
 *
 * Resolved against a read (readCanvas) of the whole board, so labels mean
 * what the model was told they mean.
 */
import { outward, span } from "./handwriting";
import type { CanvasDoc } from "./read";
import { blockWords, distToBox } from "./relations";
import { union, type Block, type Box, type Pt, type Word } from "./segment";

export type ResolvedTarget =
  | { ok: true; address: string; elementIds: string[]; box: Box }
  | { ok: false; error: string };

type Read = { doc: CanvasDoc };

const strokesOf = (words: Word[]) => words.flatMap((w) => w.glyphs.flatMap((g) => g.strokes.map((s) => s.id)));
const found = (address: string, words: Word[]): ResolvedTarget =>
  ({ ok: true, address, elementIds: strokesOf(words), box: union(words.map((w) => w.box)) });
const fail = (error: string): ResolvedTarget => ({ ok: false, error });

const EXAMPLES = `like "M1", "M1 row 2 col 3", "T1 word 2" or "T1 words 2–3"`;

/** An address or a point; see the top of this file. */
export function resolveTarget(target: string | Pt, read: Read): ResolvedTarget {
  return typeof target === "string" ? resolveLabel(target, read) : resolvePoint(target, read);
}

// ── addresses ───────────────────────────────────────────────────────────────

function resolveLabel(target: string, { doc }: Read): ResolvedTarget {
  // Lenient about case, commas, brackets and the dash in a range: "m4 (row 2, col 3)", "T1 words 3-5".
  const text = target.replace(/[(),]/g, " ").replace(/\s+/g, " ").trim();
  const head = /^([a-z])(\d+)(?: (.*))?$/i.exec(text);
  if (!head) return fail(`can't read "${target}" as a place on the board: give a label from the read, ${EXAMPLES}`);
  const label = `${head[1]!.toUpperCase()}${Number(head[2])}`;
  const rest = head[3] ?? "";

  const item = doc.items.find((i) => i.label === label);
  const block = doc.handwriting.blocks.find((b) => b.id === label);
  if (!item && !block) {
    const same = doc.items.filter((i) => i.label[0] === label[0]).map((i) => i.label);
    return fail(`no ${label} on this canvas${same.length ? ` (its ${label[0]} labels are ${same.join(", ")})` : ""}`);
  }
  if (!rest) return item ? { ok: true, address: label, elementIds: item.elementIds, box: item.box } : found(label, blockWords(block!));
  if (!block) return fail(`${label} is not handwriting, so it has no rows, columns or words: target all of it, as "${label}"`);

  const cell = /^row (\d+) (?:col|column) (\d+)$/i.exec(rest);
  const row = /^row (\d+)$/i.exec(rest);
  const col = /^(?:col|column) (\d+)$/i.exec(rest);
  const words = /^words? (\d+)(?: ?(?:[-–—]|to) ?(\d+))?$/i.exec(rest);
  if (cell || row || col) return matrixPart(block, label, cell ? [cell[1], cell[2]] : row ? [row[1], undefined] : [undefined, col![1]]);
  if (words) return textPart(block, label, Number(words[1]), Number(words[2] ?? words[1]));
  return fail(`can't read "${target}" as a place on the board: give a label from the read, ${EXAMPLES}`);
}

function matrixPart(block: Block, label: string, [r, c]: [string | undefined, string | undefined]): ResolvedTarget {
  if (block.kind !== "matrix") return fail(`${label} is a line of text, not a matrix: name a word, like "${label} word 2"`);
  const row = r === undefined ? null : Number(r);
  const col = c === undefined ? null : Number(c);
  if (row !== null && (row < 1 || row > block.rows.length)) return fail(`${label} has ${block.rows.length} rows`);
  if (col !== null && (col < 1 || col > block.columns)) return fail(`${label} has ${block.columns} columns`);
  const address = `${label}${row !== null ? ` row ${row}` : ""}${col !== null ? ` col ${col}` : ""}`;
  const cells = block.rows.flatMap((rw, i) => rw.cells.filter((w, j): w is Word => !!w && (row === null || i === row - 1) && (col === null || j === col - 1)));
  return cells.length ? found(address, cells) : fail(`${address} is empty: nothing is written there`);
}

function textPart(block: Block, label: string, a: number, b: number): ResolvedTarget {
  if (block.kind !== "text") return fail(`${label} is a matrix: name a cell, like "${label} row 1 col 2"`);
  const [from, to] = a <= b ? [a, b] : [b, a];
  const n = block.words.length;
  if (from < 1 || to > n) return fail(`${label} has ${n} ${n === 1 ? "word" : "words"}`);
  return found(`${label} ${span("word", from, to)}`, block.words.slice(from - 1, to));
}

// ── points ──────────────────────────────────────────────────────────────────

/** Every cell and word on the board, by address. */
const places = (blocks: Block[]) => blocks.flatMap((b) => (b.kind === "matrix"
  ? b.rows.flatMap((row, r) => row.cells.flatMap((w, c) => (w ? [{ address: `${b.id} row ${r + 1} col ${c + 1}`, w }] : [])))
  : b.words.map((w, i) => ({ address: `${b.id} word ${i + 1}`, w }))));

const inside = (p: Pt, b: Box) => p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
const area = (b: Box) => (b.maxX - b.minX) * (b.maxY - b.minY);
const smallest = <T>(xs: T[], box: (x: T) => Box) => xs.reduce<T | undefined>((best, x) => (!best || area(box(x)) < area(box(best)) ? x : best), undefined);

/**
 * The cell or word whose box (as printed, rounded outward) holds the point,
 * the smallest if several do; else the smallest item whose box holds it —
 * a matrix, when the point falls between its cells.
 */
function resolvePoint(p: Pt, { doc }: Read): ResolvedTarget {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return fail("a point needs a number for both x and y");
  const parts = places(doc.handwriting.blocks);
  const part = smallest(parts.filter(({ w }) => inside(p, outward(w.box))), ({ w }) => w.box);
  if (part) return found(part.address, [part.w]);
  const item = smallest(doc.items.filter((i) => inside(p, outward(i.box))), (i) => i.box);
  if (item) return { ok: true, address: item.label, elementIds: item.elementIds, box: item.box };

  const near = [...parts.map(({ address, w }) => ({ address, box: w.box })), ...doc.items.map((i) => ({ address: i.label, box: i.box }))]
    .sort((a, b) => distToBox(p, a.box) - distToBox(p, b.box))[0];
  const where = `(${Math.round(p.x)}, ${Math.round(p.y)})`;
  if (!near) return fail(`nothing is at ${where}: this canvas is empty`);
  const b = outward(near.box);
  return fail(`nothing is at ${where}; the nearest is ${near.address}, from (${b.minX}, ${b.minY}) to (${b.maxX}, ${b.maxY})`);
}
