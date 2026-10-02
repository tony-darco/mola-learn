import { generateKeyBetween } from "fractional-indexing";

/**
 * A new element always renders on top of everything else — ordering is
 * global across the whole canvas, not per-frame (see artifacts.ts's canvas
 * section for why). Sort/compare the resulting keys with plain `<`, never
 * localeCompare — fractional-indexing keys depend on code-unit ordering.
 */
export function nextIndexAfterAll(elements: { index: string }[]): string {
  let max: string | null = null;
  for (const e of elements) {
    if (max === null || e.index > max) max = e.index;
  }
  return generateKeyBetween(max, null);
}
