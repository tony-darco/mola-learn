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
export type TextBlock = { kind: "text"; id: string; box: Box; words: Word[] };
export type Block = MatrixBlock | TextBlock;
/** Blocks in reading order: top to bottom within a column of the board, columns left to right. */
export type HandwritingDoc = { blocks: Block[] };

/** A stroke this many times the typical stroke size is a candidate bracket or bar. */
const TALL_RATIO = 2.5;
/** Bracket arms must stick out this far (fraction of the bracket's height) past its spine. */
const ARM_RATIO = 0.04;
/**
 * Words on one text line split at a gap wider than this × the line's height.
 * Measured on jittered handwriting: gaps inside a word stay under ~0.6,
 * gaps between words stay over it (typically ~0.9).
 */
const WORD_GAP_RATIO = 0.6;
/** Matrix entries split at a gap wider than this × the row's height — people space entries further apart than words. */
const CELL_GAP_RATIO = 1.1;
/** Two runs of writing on the same line more than this × its height apart are separate blocks. */
const BLOCK_GAP_RATIO = 3;

// ── geometry ────────────────────────────────────────────────────────────────

export function boxOf(points: Pt[]): Box {
  const b: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of points) {
    b.minX = Math.min(b.minX, p.x); b.minY = Math.min(b.minY, p.y);
    b.maxX = Math.max(b.maxX, p.x); b.maxY = Math.max(b.maxY, p.y);
  }
  return b;
}

function union(boxes: Box[]): Box {
  return {
    minX: Math.min(...boxes.map((b) => b.minX)), minY: Math.min(...boxes.map((b) => b.minY)),
    maxX: Math.max(...boxes.map((b) => b.maxX)), maxY: Math.max(...boxes.map((b) => b.maxY)),
  };
}

const width = (b: Box) => b.maxX - b.minX;
const height = (b: Box) => b.maxY - b.minY;
const centerX = (b: Box) => (b.minX + b.maxX) / 2;
const centerY = (b: Box) => (b.minY + b.maxY) / 2;

/** `b` grown about its centre to at least `minHeight` tall — a line holding only a minus sign is still a line, not a flat band. */
function atLeastTall(b: Box, minHeight: number): Box {
  const grow = Math.max(0, minHeight - height(b)) / 2;
  return { ...b, minY: b.minY - grow, maxY: b.maxY + grow };
}

function median(values: number[]): number {
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
 * A tall, narrow stroke is a left delimiter if its ends curl to the right of
 * its spine ("[" or "("), a right delimiter if they curl left, and a bar if
 * they don't curl at all. The spine is a line fitted through the middle of
 * the stroke, so a slanted bracket still reads as a bracket.
 */
function classifyTall(ink: Ink, unit: number): TallKind | null {
  const h = height(ink.box);
  if (h < TALL_RATIO * unit || width(ink.box) > 0.5 * h) return null;

  const middle = ink.points.filter((p) => p.y > ink.box.minY + 0.3 * h && p.y < ink.box.maxY - 0.3 * h);
  if (middle.length < 2) return null;
  const my = middle.reduce((s, p) => s + p.y, 0) / middle.length;
  const mx = middle.reduce((s, p) => s + p.x, 0) / middle.length;
  const vy = middle.reduce((s, p) => s + (p.y - my) ** 2, 0);
  const slope = vy === 0 ? 0 : middle.reduce((s, p) => s + (p.y - my) * (p.x - mx), 0) / vy;
  if (Math.abs(slope) > 0.4) return null;

  let right = 0;
  let left = 0;
  for (const p of ink.points) {
    const nearEnd = p.y <= ink.box.minY + 0.15 * h || p.y >= ink.box.maxY - 0.15 * h;
    if (!nearEnd) continue;
    const r = p.x - (mx + slope * (p.y - my));
    right = Math.max(right, r);
    left = Math.max(left, -r);
  }
  const arm = ARM_RATIO * h;
  if (right >= arm && right >= 2 * left) return "left";
  if (left >= arm && left >= 2 * right) return "right";
  if (right < arm && left < arm) return "bar";
  return null;
}

// ── lines, characters, words ────────────────────────────────────────────────

/** Strokes whose vertical extents overlap belong to one line of writing. Returned top to bottom. */
function splitLines(inks: Ink[], unit: number): Ink[][] {
  const lines = groupBy(inks, (a, b) => overlapRatio(a.box.minY, a.box.maxY, b.box.minY, b.box.maxY, 0.1 * unit) > 0.25);
  return lines.sort((a, b) => union(a.map((i) => i.box)).minY - union(b.map((i) => i.box)).minY);
}

/** Strokes that overlap horizontally on one line form one character: "=", "+", a two-stroke "R". Returned left to right. */
function splitGlyphs(inks: Ink[], lineHeight: number): Glyph[] {
  return groupBy(inks, (a, b) => overlapRatio(a.box.minX, a.box.maxX, b.box.minX, b.box.maxX, 0.1 * lineHeight) >= 0.3)
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

function buildMatrix(left: Ink, right: Ink, bars: Ink[], content: Ink[], unit: number): Omit<MatrixBlock, "id"> {
  const barXs = bars.map((b) => centerX(b.box));
  const rawRows = splitLines(content, unit).map((inks) => {
    const box = atLeastTall(union(inks.map((i) => i.box)), 0.5 * unit);
    const h = height(box);
    return { box, words: splitWords(splitGlyphs(inks, h), CELL_GAP_RATIO * h, barXs) };
  });

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

/** Top to bottom within each column of the board, columns left to right; ids numbered in that order. */
function readingOrder(blocks: (Omit<MatrixBlock, "id"> | Omit<TextBlock, "id">)[]): Block[] {
  const bands = groupBy(blocks, (a, b) => Math.min(a.box.maxX, b.box.maxX) > Math.max(a.box.minX, b.box.minX))
    .map((band) => band.sort((a, b) => a.box.minY - b.box.minY || a.box.minX - b.box.minX))
    .sort((a, b) => union(a.map((x) => x.box)).minX - union(b.map((x) => x.box)).minX);

  let matrices = 0;
  let texts = 0;
  return bands.flat().map((b) => (b.kind === "matrix" ? { ...b, id: `M${++matrices}` } : { ...b, id: `T${++texts}` }));
}

export function segmentHandwriting(inks: Ink[]): HandwritingDoc {
  if (inks.length === 0) return { blocks: [] };
  // "Typical stroke size" — a digit's height, a minus sign's width.
  const unit = Math.max(1, median(inks.map((i) => Math.max(width(i.box), height(i.box)))));

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

  const texts = buildTexts(inks.filter((i) => !claimed.has(i.id)), unit);
  return { blocks: readingOrder([...matrixParts, ...texts]) };
}
