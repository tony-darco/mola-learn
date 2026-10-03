export type WidthCategory = "S" | "M" | "L" | "XL";

export const STROKE_WIDTHS: Record<WidthCategory, number> = { S: 2, M: 4, L: 8, XL: 16 };
export const ERASER_SIZES: Record<WidthCategory, number> = { S: 8, M: 16, L: 28, XL: 44 };
export const FONT_SIZES: Record<WidthCategory, number> = { S: 12, M: 16, L: 24, XL: 32 };

/** 12-color grid, matching the reference style panel — 3 rows of 4. */
export const COLOR_PALETTE = [
  "#1c1b18", "#7a776e", "#a78bda", "#7c3aed",
  "#2563eb", "#60a5fa", "#f59e0b", "#c2410c",
  "#0f766e", "#22c55e", "#ec4899", "#dc2626",
];

export const BACKGROUND_COLORS = ["#ffffff", "#f7f5ee", "#f1f5f9", "#1c1b18"];

/** Sticky-note paper is independent of the active ink color (a StylePanel
 * swatch of "black" would otherwise produce an unreadable all-black note). */
export const NOTE_DEFAULT_COLOR = "#fef08a";

/**
 * The AI's ink — annotations are drawn in it, never in a palette color, so
 * its marks can't pass for the student's. Mola's accent on a light board
 * (about 14:1); on a dark one, like the #1c1b18 swatch where the accent is
 * barely 1.2:1, a light tint of it (7.3:1). `fg` is a glyph drawn on a disc
 * of the ink.
 */
export function aiInk(background: string): { ink: string; fg: string } {
  const hex = /^#([0-9a-f]{6})$/i.exec(background)?.[1];
  const [r, g, b] = hex ? [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) : [255, 255, 255];
  const dark = 0.2126 * r! + 0.7152 * g! + 0.0722 * b! < 128;
  return dark ? { ink: "#e3958b", fg: "#1c1b18" } : { ink: "#481715", fg: "#f7f5ee" };
}
