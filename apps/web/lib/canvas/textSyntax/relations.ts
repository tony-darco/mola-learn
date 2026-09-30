/**
 * What the marks and connectors on a canvas are about: what an arrow's ends
 * touch, what a circle or shape is drawn around, what an underline or a
 * highlighter stroke covers. Always resolved to the smallest thing that has
 * an address — a matrix cell ("M4 row 2 col 3"), a run of words ("T1 words
 * 2–3"), a whole block ("M2"), or a placed element ("N1").
 *
 * Distances are multiples of the typical stroke size (`unit`), as in
 * segment.ts and marks.ts.
 */
import { span } from "./handwriting";
import { boxCenter, pointInPolygon } from "./marks";
import { centerX, centerY, height, width, type Block, type Box, type Glyph, type MatrixBlock, type Pt, type TextBlock, type Word } from "./segment";

/** An arrow end touches whatever is within this × the unit of it. */
const TOUCH = 1;
/** Inside a matrix or on a line, it points at a cell or word only if it is within this × the unit of one. */
const TOUCH_PART = 0.5;

/** Something referred to: its address as printed, the label of the item it is part of, and — for handwriting — the glyphs it covers. */
export type Target = { text: string; label: string; glyphs?: Glyph[] };

/** What marks can refer to. Everything is in print order, blocks relabelled with their stable labels. */
export type Board = {
  unit: number;
  blocks: Block[];
  /** Placed content — text boxes, notes, math, images — and shapes (which also have an outline). */
  things: { label: string; box: Box; outline?: Pt[] }[];
  /** Pointed at only when nothing else is near: an arrow ending inside a frame usually means what's in it. */
  frames: { label: string; box: Box }[];
};

// ── geometry ────────────────────────────────────────────────────────────────

const area = (b: Box) => width(b) * height(b);

export function distToBox(p: Pt, b: Box): number {
  return Math.hypot(Math.max(b.minX - p.x, 0, p.x - b.maxX), Math.max(b.minY - p.y, 0, p.y - b.maxY));
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2));
  return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)));
}

const distToOutline = (p: Pt, outline: Pt[]) =>
  Math.min(...outline.map((a, i) => distToSegment(p, a, outline[(i + 1) % outline.length]!)));

/** The polyline resampled so no two neighbours are more than `step` apart. */
function dense(points: Pt[], step: number): Pt[] {
  return points.flatMap((p, i) => {
    const prev = points[i - 1];
    if (!prev) return [p];
    const n = Math.max(1, Math.ceil(Math.hypot(p.x - prev.x, p.y - prev.y) / step));
    return Array.from({ length: n }, (_, k) => ({ x: prev.x + ((p.x - prev.x) * (k + 1)) / n, y: prev.y + ((p.y - prev.y) * (k + 1)) / n }));
  });
}

// ── addresses ───────────────────────────────────────────────────────────────

export const blockWords = (b: Block): Word[] => (b.kind === "matrix" ? b.rows.flatMap((r) => r.cells.filter((c): c is Word => !!c)) : b.words);
export const blockGlyphs = (b: Block): Glyph[] => blockWords(b).flatMap((w) => w.glyphs);

type Share = "all" | "some" | "none";
const share = (w: Word | null, covered: Set<Glyph>): Share => {
  const n = w ? w.glyphs.filter((g) => covered.has(g)).length : 0;
  return n === 0 ? "none" : n === w!.glyphs.length ? "all" : "some";
};

/** Consecutive runs of true, as 1-based [from, to]. */
function runs(flags: boolean[]): [number, number][] {
  const out: [number, number][] = [];
  flags.forEach((f, i) => {
    if (!f) return;
    const last = out[out.length - 1];
    if (last && last[1] === i) last[1] = i + 1;
    else out.push([i + 1, i + 1]);
  });
  return out;
}

function matrixParts(m: MatrixBlock, covered: Set<Glyph>): Target[] {
  const cell = (r: number, c: number) => m.rows[r]!.cells[c] ?? null;
  const shares = m.rows.map((row, r) => row.cells.map((_, c) => share(cell(r, c), covered)));
  const full = (cells: [number, number][]) => cells.some(([r, c]) => cell(r, c)) && cells.every(([r, c]) => !cell(r, c) || shares[r]![c] === "all");
  const rowCells = (r: number) => m.rows[r]!.cells.map((_, c): [number, number] => [r, c]);
  const colCells = (c: number) => m.rows.map((_, r): [number, number] => [r, c]);
  const glyphsOf = (cells: [number, number][]) => cells.flatMap(([r, c]) => cell(r, c)?.glyphs ?? []);

  const out: Target[] = [];
  const done = new Set<string>();
  const add = (text: string, cells: [number, number][]) => {
    out.push({ text: `${m.id} ${text}`, label: m.id, glyphs: glyphsOf(cells) });
    cells.forEach(([r, c]) => done.add(`${r},${c}`));
  };
  const fullRows = m.rows.map((_, r) => full(rowCells(r)));
  for (const [a, b] of runs(fullRows)) add(span("row", a, b), Array.from({ length: b - a + 1 }, (_, i) => rowCells(a - 1 + i)).flat());
  // A column counts when all of it is covered and some of it lies outside the rows already named.
  const fullCols = Array.from({ length: m.columns }, (_, c) => full(colCells(c)) && colCells(c).some(([r, cc]) => cell(r, cc) && !fullRows[r]));
  for (const [a, b] of runs(fullCols)) add(span("col", a, b), Array.from({ length: b - a + 1 }, (_, i) => colCells(a - 1 + i)).flat());
  m.rows.forEach((row, r) => {
    for (const [a, b] of runs(row.cells.map((_, c) => shares[r]![c] === "all" && !done.has(`${r},${c}`)))) {
      add(`row ${r + 1} ${span("col", a, b)}`, Array.from({ length: b - a + 1 }, (_, i): [number, number] => [r, a - 1 + i]));
    }
  });
  m.rows.forEach((row, r) => row.cells.forEach((c, i) => {
    if (shares[r]![i] === "some") out.push({ text: `part of ${m.id} row ${r + 1} col ${i + 1}`, label: m.id, glyphs: c!.glyphs.filter((g) => covered.has(g)) });
  }));
  return out;
}

function textParts(t: TextBlock, covered: Set<Glyph>): Target[] {
  const shares = t.words.map((w) => share(w, covered));
  return [
    ...runs(shares.map((s) => s === "all")).map(([a, b]): Target => ({
      text: `${t.id} ${span("word", a, b)}`, label: t.id, glyphs: t.words.slice(a - 1, b).flatMap((w) => w.glyphs),
    })),
    ...t.words.flatMap((w, i): Target[] => (shares[i] === "some"
      ? [{ text: `part of ${t.id} word ${i + 1}`, label: t.id, glyphs: w.glyphs.filter((g) => covered.has(g)) }]
      : [])),
  ];
}

/** Handwritten glyphs as addresses: a whole block when all of it is covered, else its rows, columns, cells, or words. */
export function addressGlyphs(covered: Set<Glyph>, blocks: Block[]): Target[] {
  return blocks.flatMap((b) => {
    const all = blockGlyphs(b);
    if (!all.some((g) => covered.has(g))) return [];
    if (all.every((g) => covered.has(g))) return [{ text: b.id, label: b.id, glyphs: all }];
    return b.kind === "matrix" ? matrixParts(b, covered) : textParts(b, covered);
  });
}

const whole = (label: string): Target => ({ text: label, label });

// ── relations ───────────────────────────────────────────────────────────────

/** What a point — an arrow's or a line's end — touches, or null if nothing is near it. */
export function touching(p: Pt, board: Board): Target | null {
  const tol = TOUCH * board.unit;
  const found: { target: Target; d: number; area: number }[] = [];
  for (const b of board.blocks) {
    const d = distToBox(p, b.box);
    if (d > tol) continue;
    // Past the brackets inside a matrix, or on a line of text, it may point at one cell or word.
    const parts = b.kind === "matrix"
      ? (p.x > b.delimiters.left.box.maxX && p.x < b.delimiters.right.box.minX && d === 0
        ? b.rows.flatMap((row, r) => row.cells.flatMap((c, i) => (c ? [{ w: c, text: `${b.id} row ${r + 1} col ${i + 1}` }] : [])))
        : [])
      : (d === 0 ? b.words.map((w, i) => ({ w, text: `${b.id} word ${i + 1}` })) : []);
    const nearest = parts.map((x) => ({ ...x, d: distToBox(p, x.w.box) })).sort((x, y) => x.d - y.d)[0];
    found.push(nearest && nearest.d <= TOUCH_PART * board.unit
      ? { target: { text: nearest.text, label: b.id, glyphs: nearest.w.glyphs }, d: 0, area: area(nearest.w.box) }
      : { target: { text: b.id, label: b.id, glyphs: blockGlyphs(b) }, d, area: area(b.box) });
  }
  for (const t of board.things) {
    const d = t.outline ? distToOutline(p, t.outline) : distToBox(p, t.box);
    if (d <= tol) found.push({ target: whole(t.label), d, area: area(t.box) });
  }
  const best = found.sort((a, b) => a.d - b.d || a.area - b.area)[0];
  if (best) return best.target;
  const frame = board.frames.filter((f) => distToBox(p, f.box) <= tol).sort((a, b) => distToBox(p, a.box) - distToBox(p, b.box) || area(a.box) - area(b.box))[0];
  return frame ? whole(frame.label) : null;
}

/** What a closed outline — a pen circle, a shape — is drawn around: glyphs whose centre is inside it, and smaller things whose centre is. */
export function enclosedBy(outline: Pt[], box: Box, board: Board, self?: string): Target[] {
  const inside = (b: Box) => pointInPolygon(boxCenter(b), outline);
  const glyphs = new Set(board.blocks.flatMap(blockGlyphs).filter((g) => inside(g.box)));
  return [
    ...addressGlyphs(glyphs, board.blocks),
    ...board.things.filter((t) => t.label !== self && inside(t.box) && area(t.box) < area(box)).map((t) => whole(t.label)),
  ];
}

/**
 * What a highlighter stroke is drawn over: every glyph or placed thing its
 * inked band — the polyline, `halfWidth` either side — reaches.
 */
export function coveredBy(points: Pt[], halfWidth: number, board: Board): Target[] {
  const path = dense(points, Math.max(halfWidth / 2, 0.05 * board.unit));
  const reached = (b: Box) => path.some((p) => distToBox(p, b) <= halfWidth);
  const glyphs = new Set(board.blocks.flatMap(blockGlyphs).filter((g) => reached(g.box)));
  return [
    ...addressGlyphs(glyphs, board.blocks),
    ...board.things.filter((t) => !t.outline && reached(t.box)).map((t) => whole(t.label)),
  ];
}

/**
 * What an underline is under: the nearest writing above it — the glyphs of
 * that one line or matrix row whose centres lie over it — or a placed thing,
 * if that is nearer.
 */
export function underlinedBy(line: Box, board: Board): Target[] {
  const y = centerY(line);
  const over = (b: Box) => centerX(b) >= line.minX && centerX(b) <= line.maxX && centerY(b) < y;
  const bands = board.blocks.flatMap((b) => (b.kind === "text" ? [b.words] : b.rows.map((r) => r.cells.filter((c): c is Word => !!c))))
    .map((words) => words.flatMap((w) => w.glyphs).filter((g) => over(g.box)))
    .filter((gs) => gs.length > 0)
    .map((gs) => ({ gs, gap: Math.min(...gs.map((g) => Math.abs(y - g.box.maxY))) }));
  const things = board.things.filter((t) => !t.outline && over(t.box)).map((t) => ({ t, gap: Math.abs(y - t.box.maxY) }));
  const band = bands.sort((a, b) => a.gap - b.gap)[0];
  const thing = things.sort((a, b) => a.gap - b.gap)[0];
  if (thing && (!band || thing.gap < band.gap)) return [whole(thing.t.label)];
  return band ? addressGlyphs(new Set(band.gs), board.blocks) : [];
}
