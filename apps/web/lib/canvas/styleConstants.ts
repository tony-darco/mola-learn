export type WidthCategory = "S" | "M" | "L" | "XL";

export const STROKE_WIDTHS: Record<WidthCategory, number> = { S: 2, M: 4, L: 8, XL: 16 };
export const ERASER_SIZES: Record<WidthCategory, number> = { S: 8, M: 16, L: 28, XL: 44 };

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
