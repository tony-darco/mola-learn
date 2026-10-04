/**
 * Turns loose pen strokes into written structure — bracketed matrices (rows,
 * cells, augmented bars) and lines of text (words, characters) — using only
 * geometry. Nothing here knows what any character *is*; that's left to
 * whoever reads the bitmaps (bitmap.ts) this feeds.
 *
 * Every threshold is relative: to the typical stroke size on the canvas, or
 * to the height of the line being split. That keeps it independent of zoom
 * level and handwriting size.
 */
import type { CanvasElement } from "@mola/shared";

export type Pt = { x: number; y: number };
export type Box = { minX: number; minY: number; maxX: number; maxY: number };
/** One pen stroke, in absolute canvas coordinates. `id` is the canvas element id. */
export type Ink = { id: string; points: Pt[]; box: Box };
export type Glyph = { strokes: Ink[]; box: Box };
/** A run of characters with no real gap inside it: a number in a cell, a word on a line. */
export type Word = { glyphs: Glyph[]; box: Box };

export type MatrixRow = { box: Box; cells: (Word | null)[] };
export type MatrixBlock = {
  kind: "matrix"; id: string; box: Box;
  delimiters: { left: Ink; right: Ink };
  /** `afterColumn` is 1-based: 3 means the bar sits between columns 3 and 4. */
  bars: { ink: Ink; afterColumn: number }[];
  columns: number;
  rows: MatrixRow[];
};
/** One line of writing. Its box is also the reference band every character on it is drawn against. */
export type TextBlock = {
  kind: "text"; id: string; box: Box; words: Word[];
  /**
   * Only for the operators written between matrices on one row, "[..] × [..] = [..]":
   * the matrices, left to right, by their left delimiters. Word i sits between matrices i and i + 1.
   */
  operands?: Ink[];
};
export type Block = MatrixBlock | TextBlock;
/** Blocks in reading order: top to bottom within a column of the board, columns left to right. */
export type HandwritingDoc = { blocks: Block[] };

/** A stroke this many times the typical stroke size is a candidate bracket or bar. */
const TALL_RATIO = 2.5;
/** Bracket arms must stick out this far (fraction of the bracket's height) past its spine. */
const ARM_RATIO = 0.04;
/** A bracket's spine is fitted to the stroke less this fraction of its height at each end, where the arms are. */
const SPINE_END = 0.15;
/**
 * Words on one text line split at a gap wider than this × the line's height.
 * Measured on jittered handwriting: gaps inside a word stay under ~0.6,
 * gaps between words stay over it (typically ~0.9).
 */
const WORD_GAP_RATIO = 0.6;
/**
 * Matrix entries always split at a gutter wider than this × the row's
 * height. Narrower ones (see cellBreaks) split where gutter widths jump by
 * CELL_GAP_JUMP or more, to at least CELL_GAP_MIN — widths under
 * GUTTER_FLOOR count as GUTTER_FLOOR, so two tight gaps inside numbers don't
 * make a jump — and, if they don't jump, all split when their median is
 * CELL_GAP_ALONE or more. Tuned on jitter seeds 1–20 of the reader board's
 * tightly spaced matrix multiplication (planReaderBoard({ seed })), keeping
 * the matrix reduction's widely spaced entries exact.
 */
const CELL_GAP_RATIO = 1.1;
const CELL_GAP_JUMP = 1.4;
const CELL_GAP_MIN = 0.4;
const GUTTER_FLOOR = 0.2;
const CELL_GAP_ALONE = 0.5;
/** Gaps in different rows of a matrix are one gutter when their middles are within this × the row height of each other. */
const GUTTER_ALIGN = 0.3;
/** A typical glyph in a matrix is at least this × its typical glyph height wide, however many narrow "1"s it holds. */
const GLYPH_WIDTH = 0.5;
/** Two runs of writing on the same line more than this × its height apart are separate blocks. */
const BLOCK_GAP_RATIO = 3;
/** A stroke that comes within this × the line's height of another is part of the same character, if the two are no wider together than JOIN_WIDTH × the line's height. */
const JOIN_RATIO = 0.08;
const JOIN_WIDTH = 0.8;
/** Writing between two matrices taller than this × the typical stroke size isn't an operator joining them. */
const OPERATOR_RATIO = 1.5;
/** A dot is no bigger than this × the line's height. */
const DOT_RATIO = 0.2;

// ── geometry ────────────────────────────────────────────────────────────────

export function boxOf(points: Pt[]): Box {
  const b: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of points) {
    b.minX = Math.min(b.minX, p.x); b.minY = Math.min(b.minY, p.y);
    b.maxX = Math.max(b.maxX, p.x); b.maxY = Math.max(b.maxY, p.y);
  }
  return b;
}

export function union(boxes: Box[]): Box {
  return {
    minX: Math.min(...boxes.map((b) => b.minX)), minY: Math.min(...boxes.map((b) => b.minY)),
    maxX: Math.max(...boxes.map((b) => b.maxX)), maxY: Math.max(...boxes.map((b) => b.maxY)),
  };
}

export const width = (b: Box) => b.maxX - b.minX;
export const height = (b: Box) => b.maxY - b.minY;
export const centerX = (b: Box) => (b.minX + b.maxX) / 2;
export const centerY = (b: Box) => (b.minY + b.maxY) / 2;

/** `b` grown about its centre to at least `minHeight` tall — a line holding only a minus sign is still a line, not a flat band. */
function atLeastTall(b: Box, minHeight: number): Box {
  const grow = Math.max(0, minHeight - height(b)) / 2;
  return { ...b, minY: b.minY - grow, maxY: b.maxY + grow };
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Partitions `items` into connected groups, where `linked(a, b)` joins two items. Group order follows first appearance. */
function groupBy<T>(items: T[], linked: (a: T, b: T) => boolean): T[][] {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (find(i) !== find(j) && linked(items[i]!, items[j]!)) parent[find(j)] = find(i);
    }
  }
  const groups = new Map<number, T[]>();
  items.forEach((item, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(item);
  });
  return [...groups.values()];
}

/**
 * Overlap of two 1-D intervals as a fraction of the shorter one. An interval
 * thinner than `minSpan` (a flat minus sign's height, a vertical stroke's
 * width) is widened to it around its centre, so it still counts as
 * overlapping whatever it sits inside.
 */
function overlapRatio(a0: number, a1: number, b0: number, b1: number, minSpan: number): number {
  const pad = (lo: number, hi: number): [number, number] => {
    if (hi - lo >= minSpan) return [lo, hi];
    const c = (lo + hi) / 2;
    return [c - minSpan / 2, c + minSpan / 2];
  };
  const [p0, p1] = pad(a0, a1);
  const [q0, q1] = pad(b0, b1);
  return (Math.min(p1, q1) - Math.max(p0, q0)) / Math.min(p1 - p0, q1 - q0);
}

// ── input ───────────────────────────────────────────────────────────────────

/** Pen strokes only — highlighter marks are emphasis, not writing. */
export function inkFromElements(elements: CanvasElement[]): Ink[] {
  return elements.flatMap((e) => {
    if (e.type !== "draw" || e.props.variant !== "pen" || e.props.points.length === 0) return [];
    const points = e.props.points.map((p) => ({ x: e.x + p.x, y: e.y + p.y }));
    return [{ id: e.id, points, box: boxOf(points) }];
  });
}

// ── brackets and bars ───────────────────────────────────────────────────────

type TallKind = "left" | "right" | "bar";

/**
 * A tall, narrow stroke is a left delimiter if both its ends curl to the
 * right of its spine ("[" or "("), a right delimiter if both curl left, and a
 * bar if neither curls. The spine is a line fitted through all but the ends
 * of the stroke, so a slanted bracket still reads as a bracket, and a shaky
 * one's wobble barely tilts it. Where the pen starts and stops says which
 * way the arms point even when a corner overshoots or the spine wobbles as
 * far as the arms reach; a stroke with one end curled and one not (a tall
 * "1", a hook) is none of the three.
 */
function classifyTall(ink: Ink, unit: number): TallKind | null {
  const h = height(ink.box);
  if (h < TALL_RATIO * unit || width(ink.box) > 0.5 * h) return null;

  const middle = ink.points.filter((p) => p.y > ink.box.minY + SPINE_END * h && p.y < ink.box.maxY - SPINE_END * h);
  if (middle.length < 2) return null;
  const my = middle.reduce((s, p) => s + p.y, 0) / middle.length;
  const mx = middle.reduce((s, p) => s + p.x, 0) / middle.length;
  const vy = middle.reduce((s, p) => s + (p.y - my) ** 2, 0);
  const slope = vy === 0 ? 0 : middle.reduce((s, p) => s + (p.y - my) * (p.x - mx), 0) / vy;
  if (Math.abs(slope) > 0.4) return null;

  const arm = ARM_RATIO * h;
  const curl = (p: Pt) => {
    const r = p.x - (mx + slope * (p.y - my));
    return r >= arm ? 1 : r <= -arm ? -1 : 0;
  };
  const ends = [curl(ink.points[0]!), curl(ink.points[ink.points.length - 1]!)];
  if (ends[0] !== ends[1]) return null;
  return ends[0] === 1 ? "left" : ends[0] === -1 ? "right" : "bar";
}

// ── lines, characters, words ────────────────────────────────────────────────

/** Strokes whose vertical extents overlap belong to one line of writing. Returned top to bottom. */
function splitLines(inks: Ink[], unit: number): Ink[][] {
  const lines = groupBy(inks, (a, b) => overlapRatio(a.box.minY, a.box.maxY, b.box.minY, b.box.maxY, 0.1 * unit) > 0.25);
  return lines.sort((a, b) => union(a.map((i) => i.box)).minY - union(b.map((i) => i.box)).minY);
}

function distToPolyline(p: Pt, points: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[Math.min(i + 1, points.length - 1)]!;
    const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y))));
  }
  return best;
}

/**
 * Two strokes on one line are one character when they overlap horizontally
 * ("=", "÷", a two-stroke "R"); when they meet (the arms of a "Y" or "k",
 * the arch of an "r", the bar of an "H"); or when one is a dot just above
 * the other (the dot of an "i" or "j").
 */
function sameGlyph(a: Ink, b: Ink, lineHeight: number): boolean {
  if (overlapRatio(a.box.minX, a.box.maxX, b.box.minX, b.box.maxX, 0.1 * lineHeight) >= 0.3) return true;
  const dot = (s: Ink) => Math.max(width(s.box), height(s.box)) <= DOT_RATIO * lineHeight;
  const dotOver = (d: Ink, stem: Ink) => dot(d) && height(stem.box) > 2 * height(d.box)
    && centerX(d.box) >= stem.box.minX - 0.1 * lineHeight && centerX(d.box) <= stem.box.maxX + 0.1 * lineHeight
    && d.box.maxY <= stem.box.minY + 0.1 * lineHeight && stem.box.minY - d.box.maxY <= 0.5 * lineHeight;
  if (dotOver(a, b) || dotOver(b, a)) return true;
  const reach = JOIN_RATIO * lineHeight;
  const apart = (p: Box, q: Box) => p.minX - q.maxX > reach || q.minX - p.maxX > reach || p.minY - q.maxY > reach || q.minY - p.maxY > reach;
  if (apart(a.box, b.box)) return false;
  // Touching strokes are one character only if together they are no wider than one:
  // neighbours crowded together touch too — the bowl of an "R" on the top of a "3".
  if (Math.max(a.box.maxX, b.box.maxX) - Math.min(a.box.minX, b.box.minX) > JOIN_WIDTH * lineHeight) return false;
  return a.points.some((p) => distToPolyline(p, b.points) <= reach) || b.points.some((p) => distToPolyline(p, a.points) <= reach);
}

/** Strokes of one character (see sameGlyph) grouped. Returned left to right. */
function splitGlyphs(inks: Ink[], lineHeight: number): Glyph[] {
  return groupBy(inks, (a, b) => sameGlyph(a, b, lineHeight))
    .map((strokes) => ({ strokes, box: union(strokes.map((s) => s.box)) }))
    .sort((a, b) => a.box.minX - b.box.minX);
}

/** Left-to-right characters into words, breaking at gaps wider than `maxGap` or at any of `breaks` (x positions). */
function splitWords(glyphs: Glyph[], maxGap: number, breaks: number[] = []): Word[] {
  const words: Word[] = [];
  for (const g of glyphs) {
    const current = words[words.length - 1];
    const splitByBreak = current && breaks.some((x) => x > current.box.maxX && x < g.box.minX);
    if (current && !splitByBreak && g.box.minX - current.box.maxX <= maxGap) {
      current.glyphs.push(g);
      current.box = union([current.box, g.box]);
    } else {
      words.push({ glyphs: [g], box: g.box });
    }
  }
  return words;
}

// ── blocks ──────────────────────────────────────────────────────────────────

/**
 * Where a matrix's rows split into entries, as x positions between glyphs.
 *
 * A gap between two glyphs is measured between their centres, less a typical
 * glyph's width (the matrix's median, and at least GLYPH_WIDTH × its median
 * glyph height), so a narrow "1" doesn't open a gap inside "19" or "11"; and
 * as a fraction of its row's height. Gaps are judged by gutter: the gaps of
 * different rows at the same place across the matrix (their centres'
 * midpoints within GUTTER_ALIGN × the row height) are one gutter, as wide as
 * their mean, since an entry boundary runs down every row and one jittered
 * glyph can throw any single gap. Gutters split where their widths jump the
 * most — gaps inside numbers against gaps between entries — if the jump is
 * big enough; otherwise they are all one kind, and their typical width says
 * which. A gutter wider than CELL_GAP_RATIO always splits. A bar always
 * splits, and its gap isn't a gutter.
 */
function cellBreaks(rows: { box: Box; glyphs: Glyph[] }[], barXs: number[]): number[] {
  const glyphWidth = Math.max(
    median(rows.flatMap((r) => r.glyphs.map((g) => width(g.box)))),
    GLYPH_WIDTH * median(rows.flatMap((r) => r.glyphs.map((g) => height(g.box)))),
  );
  const gaps = rows.flatMap((r, row) => {
    const out: { row: number; at: number; break: number; h: number; size: number }[] = [];
    let prev: Glyph | null = null;
    for (const g of r.glyphs) {
      // Overlapping or touching glyphs, and a bar between, never make a gutter.
      if (prev && g.box.minX > prev.box.maxX && !barXs.some((x) => x > prev!.box.maxX && x < g.box.minX)) {
        const h = height(r.box);
        out.push({
          row, h,
          at: (centerX(prev.box) + centerX(g.box)) / 2,
          break: (prev.box.maxX + g.box.minX) / 2,
          size: (centerX(g.box) - centerX(prev.box) - glyphWidth) / h,
        });
      }
      if (!prev || g.box.maxX > prev.box.maxX) prev = g;
    }
    return out;
  });
  const gutters = groupBy(gaps, (a, b) => a.row !== b.row && Math.abs(a.at - b.at) <= GUTTER_ALIGN * Math.max(a.h, b.h))
    .map((gs) => ({ gaps: gs, size: gs.reduce((s, g) => s + g.size, 0) / gs.length }));
  const sizes = gutters.map((g) => g.size).sort((a, b) => a - b);

  let jump = { ratio: 0, at: Infinity };
  for (let i = 1; i < sizes.length; i++) {
    const ratio = sizes[i]! / Math.max(sizes[i - 1]!, GUTTER_FLOOR);
    if (sizes[i]! >= CELL_GAP_MIN && ratio > jump.ratio) jump = { ratio, at: sizes[i]! };
  }
  const threshold = Math.min(CELL_GAP_RATIO, jump.ratio >= CELL_GAP_JUMP ? jump.at : median(sizes) >= CELL_GAP_ALONE ? 0 : Infinity);
  return [...barXs, ...gutters.filter((g) => g.size >= threshold).flatMap((g) => g.gaps.map((x) => x.break))];
}

function buildMatrix(left: Ink, right: Ink, bars: Ink[], content: Ink[], unit: number): Omit<MatrixBlock, "id"> {
  const barXs = bars.map((b) => centerX(b.box));
  const lines = splitLines(content, unit).map((inks) => {
    const box = atLeastTall(union(inks.map((i) => i.box)), 0.5 * unit);
    return { box, glyphs: splitGlyphs(inks, height(box)) };
  });
  const breaks = cellBreaks(lines, barXs);
  const rawRows = lines.map((r) => ({ box: r.box, words: splitWords(r.glyphs, Infinity, breaks) }));

  // Columns come from the fullest rows; every other row's entries snap to the nearest one.
  const columns = Math.max(0, ...rawRows.map((r) => r.words.length));
  const full = rawRows.filter((r) => r.words.length === columns);
  const anchors = Array.from({ length: columns }, (_, c) => full.reduce((s, r) => s + centerX(r.words[c]!.box), 0) / full.length);

  const rows: MatrixRow[] = rawRows.map((r) => {
    const cells: (Word | null)[] = Array(columns).fill(null);
    for (const w of r.words) {
      const c = anchors.reduce((best, a, i) => (Math.abs(a - centerX(w.box)) < Math.abs(anchors[best]! - centerX(w.box)) ? i : best), 0);
      const existing = cells[c];
      cells[c] = existing ? { glyphs: [...existing.glyphs, ...w.glyphs], box: union([existing.box, w.box]) } : w;
    }
    return { box: r.box, cells };
  });

  return {
    kind: "matrix",
    box: union([left.box, right.box]),
    delimiters: { left, right },
    bars: bars.map((ink) => ({ ink, afterColumn: anchors.filter((a) => a < centerX(ink.box)).length })),
    columns,
    rows,
  };
}

function buildTexts(inks: Ink[], unit: number): Omit<TextBlock, "id">[] {
  const out: Omit<TextBlock, "id">[] = [];
  // A very tall stroke would bridge every line it passes; it stands alone instead.
  const oversized = inks.filter((i) => height(i.box) >= TALL_RATIO * unit);
  const regular = inks.filter((i) => height(i.box) < TALL_RATIO * unit);

  for (const line of splitLines(regular, unit)) {
    const lineHeight = Math.max(height(union(line.map((i) => i.box))), 0.5 * unit);
    const glyphs = splitGlyphs(line, lineHeight);
    // Far-apart runs on the same line are separate pieces of writing (e.g. two columns of the board).
    for (const run of splitWords(glyphs, BLOCK_GAP_RATIO * lineHeight)) {
      out.push({ kind: "text", box: atLeastTall(run.box, 0.5 * unit), words: splitWords(run.glyphs, WORD_GAP_RATIO * lineHeight) });
    }
  }
  for (const ink of oversized) {
    const glyph: Glyph = { strokes: [ink], box: ink.box };
    out.push({ kind: "text", box: ink.box, words: [{ glyphs: [glyph], box: ink.box }] });
  }
  return out;
}

/**
 * The operators written between matrices on one row — "[..] × [..] = [..]" —
 * as one line of text tied to the matrices it joins (TextBlock.operands), so
 * the row reads as one expression rather than as matrices and a stray line.
 * Neighbouring matrices on a row, no further apart than the taller is high,
 * are joined when small writing sits between them, level with both; that
 * writing is one word. `loose` is the writing no block has claimed.
 */
function matrixExpressions(matrices: Omit<MatrixBlock, "id">[], loose: Ink[], unit: number): Omit<TextBlock, "id">[] {
  const byX = [...matrices].sort((a, b) => a.box.minX - b.box.minX);
  const next = (a: Omit<MatrixBlock, "id">) => byX.find((b) => b.box.minX >= a.box.maxX
    && b.box.minX - a.box.maxX <= Math.max(height(a.box), height(b.box))
    && overlapRatio(a.box.minY, a.box.maxY, b.box.minY, b.box.maxY, 1) >= 0.5);
  const between = (a: Omit<MatrixBlock, "id">, b: Omit<MatrixBlock, "id">) => {
    const top = Math.max(a.box.minY, b.box.minY);
    const bottom = Math.min(a.box.maxY, b.box.maxY);
    return loose.filter((i) => i.box.minX >= a.box.maxX && i.box.maxX <= b.box.minX
      && centerY(i.box) > top && centerY(i.box) < bottom && height(i.box) <= OPERATOR_RATIO * unit);
  };

  const joined = new Set<Omit<MatrixBlock, "id">>();
  const out: Omit<TextBlock, "id">[] = [];
  for (const first of byX) {
    if (joined.has(first)) continue;
    const operands = [first];
    const operators: Ink[][] = [];
    for (let b = next(first); b && !joined.has(b); b = next(b)) {
      const inks = between(operands[operands.length - 1]!, b);
      if (inks.length === 0) break;
      operands.push(b);
      operators.push(inks);
    }
    if (operators.length === 0) continue;
    operands.forEach((m) => joined.add(m));
    const lineHeight = Math.max(height(union(operators.flat().map((i) => i.box))), 0.5 * unit);
    const words = operators.map((inks): Word => {
      const glyphs = splitGlyphs(inks, lineHeight);
      return { glyphs, box: union(glyphs.map((g) => g.box)) };
    });
    out.push({ kind: "text", box: atLeastTall(union(words.map((w) => w.box)), 0.5 * unit), words, operands: operands.map((m) => m.delimiters.left) });
  }
  return out;
}

/** Top to bottom within each column of the board (things whose x-extents overlap), columns left to right. */
export function inReadingOrder<T extends { box: Box }>(items: T[]): T[] {
  return groupBy(items, (a, b) => Math.min(a.box.maxX, b.box.maxX) > Math.max(a.box.minX, b.box.minX))
    .map((band) => band.sort((a, b) => a.box.minY - b.box.minY || a.box.minX - b.box.minX))
    .sort((a, b) => union(a.map((x) => x.box)).minX - union(b.map((x) => x.box)).minX)
    .flat();
}

/** Reading order, with ids numbered in that order. */
function readingOrder(blocks: (Omit<MatrixBlock, "id"> | Omit<TextBlock, "id">)[]): Block[] {
  let matrices = 0;
  let texts = 0;
  return inReadingOrder(blocks).map((b) => (b.kind === "matrix" ? { ...b, id: `M${++matrices}` } : { ...b, id: `T${++texts}` }));
}

/** "Typical stroke size" — a digit's height, a minus sign's width. Every threshold here and in marks.ts is a multiple of it. */
export function strokeUnit(inks: Ink[]): number {
  return Math.max(1, median(inks.map((i) => Math.max(width(i.box), height(i.box)))));
}

export function segmentHandwriting(inks: Ink[]): HandwritingDoc {
  if (inks.length === 0) return { blocks: [] };
  const unit = strokeUnit(inks);

  const kinds = new Map(inks.map((i) => [i.id, classifyTall(i, unit)]));
  const lefts = inks.filter((i) => kinds.get(i.id) === "left").sort((a, b) => a.box.minX - b.box.minX);
  const rights = inks.filter((i) => kinds.get(i.id) === "right");
  const bars = inks.filter((i) => kinds.get(i.id) === "bar");

  // Pair each left delimiter with the nearest right one to its right that spans about the same rows.
  const pairs: { left: Ink; right: Ink }[] = [];
  const usedRights = new Set<string>();
  for (const left of lefts) {
    const right = rights
      .filter((r) => {
        if (usedRights.has(r.id) || r.box.minX <= left.box.maxX) return false;
        const ratio = height(r.box) / height(left.box);
        return ratio > 0.6 && ratio < 1.67 && overlapRatio(left.box.minY, left.box.maxY, r.box.minY, r.box.maxY, 1) >= 0.6;
      })
      .sort((a, b) => a.box.minX - b.box.minX)[0];
    if (right) {
      usedRights.add(right.id);
      pairs.push({ left, right });
    }
  }

  const claimed = new Set<string>();
  const matrixParts = pairs.map(({ left, right }) => {
    const top = Math.min(left.box.minY, right.box.minY);
    const bottom = Math.max(left.box.maxY, right.box.maxY);
    // No slack past the brackets' ends: whatever is written just under a
    // matrix (a row-operation label) often sits only a few px below them.
    const inside = (i: Ink) => {
      const cx = centerX(i.box);
      const cy = centerY(i.box);
      return cx > left.box.maxX && cx < right.box.minX && cy > top && cy < bottom;
    };
    claimed.add(left.id);
    claimed.add(right.id);
    const ownBars = bars.filter((b) => !claimed.has(b.id) && inside(b));
    ownBars.forEach((b) => claimed.add(b.id));
    const content = inks.filter((i) => !claimed.has(i.id) && kinds.get(i.id) === null && inside(i));
    content.forEach((i) => claimed.add(i.id));
    return buildMatrix(left, right, ownBars, content, unit);
  });

  const expressions = matrixExpressions(matrixParts, inks.filter((i) => !claimed.has(i.id) && kinds.get(i.id) === null), unit);
  for (const e of expressions) for (const w of e.words) for (const g of w.glyphs) for (const s of g.strokes) claimed.add(s.id);
  const texts = buildTexts(inks.filter((i) => !claimed.has(i.id)), unit);
  return { blocks: readingOrder([...matrixParts, ...expressions, ...texts]) };
}
