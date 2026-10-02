/**
 * Draws a word's characters as small ASCII bitmaps — "#" ink, "." paper —
 * for a reader that gets text, not images.
 *
 * Every character is drawn against the same band (its matrix row's box, or
 * its text line's box), not its own box, so small marks keep their size and
 * height: a minus is a short run in the middle rows, "=" two runs, and a
 * digit fills the band top to bottom.
 */
import type { Box, Glyph, Pt, Word } from "./segment";

export const DEFAULT_BITMAP_ROWS = 9;

function plot(grid: string[][], x0: number, y0: number, pixel: number, p: Pt) {
  const r = Math.min(grid.length - 1, Math.max(0, Math.round((p.y - y0) / pixel)));
  const c = Math.min(grid[0]!.length - 1, Math.max(0, Math.round((p.x - x0) / pixel)));
  grid[r]![c] = "#";
}

/** One glyph as `rows` strings. Row r, column c is the band point nearest (glyph left + c·pixel, band top + r·pixel). */
function renderGlyph(glyph: Glyph, band: Box, rows: number, pixel: number): string[] {
  const cols = Math.max(1, Math.round((glyph.box.maxX - glyph.box.minX) / pixel) + 1);
  const grid = Array.from({ length: rows }, () => Array<string>(cols).fill("."));
  const x0 = glyph.box.minX;
  // Sampling a third of a pixel apart leaves no gaps in a drawn line.
  const step = pixel / 3;
  for (const stroke of glyph.strokes) {
    stroke.points.forEach((p, i) => {
      const prev = stroke.points[i - 1];
      if (!prev) return plot(grid, x0, band.minY, pixel, p);
      const n = Math.max(1, Math.ceil(Math.hypot(p.x - prev.x, p.y - prev.y) / step));
      for (let k = 1; k <= n; k++) {
        plot(grid, x0, band.minY, pixel, { x: prev.x + ((p.x - prev.x) * k) / n, y: prev.y + ((p.y - prev.y) * k) / n });
      }
    });
  }
  return grid.map((row) => row.join(""));
}

/** A word's glyphs side by side, one space column apart, as `rows` lines. */
export function renderWord(word: Word, band: Box, rows: number = DEFAULT_BITMAP_ROWS): string[] {
  const pixel = Math.max(band.maxY - band.minY, 1) / (rows - 1);
  const glyphs = word.glyphs.map((g) => renderGlyph(g, band, rows, pixel));
  return Array.from({ length: rows }, (_, r) => glyphs.map((g) => g[r]).join(" "));
}
