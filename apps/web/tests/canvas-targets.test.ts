/**
 * Pointing at the board (lib/canvas/textSyntax/targets.ts): an address from
 * the read, or a point, resolves to exactly the strokes or element meant —
 * or to an error the model can act on. And the opt-in coordinates in the
 * read (readCanvas `coordinates`) agree with point resolution.
 */
import { describe, expect, it } from "vitest";
import type { CanvasElement } from "@mola/shared";
import { readCanvas, resolveTarget, type ResolvedTarget } from "../lib/canvas/textSyntax";
import { makeBoard } from "../evals/canvas-annotate/fixtures";
import { textBox } from "../evals/canvas-reader/fixtures";

// The annotate eval's clean board: the 8-step reduction (M1–M8, row operations T1–T7) and "2 + 2 = 5" (T8), plus a text box.
const board = makeBoard("clean");
const elements: CanvasElement[] = [...board.elements, textBox("x1", 1330, 400, "Remember to check")];
const read = readCanvas(elements, { render: "raw" });
const [slip, line] = board.errors;

const ok = (r: ResolvedTarget) => {
  if (!r.ok) throw new Error(r.error);
  return r;
};
const error = (r: ResolvedTarget) => (r.ok ? `resolved to ${r.address}` : r.error);
const strokesOfWord = (label: string, word: number) => ok(resolveTarget(`${label} word ${word}`, read)).elementIds;

describe("resolveTarget: addresses", () => {
  it("knows where the planted errors are", () => {
    expect(slip!.address).toBe("M8 row 1 col 4");
    expect(line!.address).toBe("T8 word 5");
  });

  it("resolves a cell to exactly its strokes", () => {
    const r = ok(resolveTarget("M8 row 1 col 4", read));
    expect(r.address).toBe("M8 row 1 col 4");
    expect(r.elementIds).toEqual(slip!.strokeIds);
    expect(r.box).toEqual(slip!.box);
  });

  it("resolves a word, and a range of words", () => {
    expect(ok(resolveTarget("T8 word 5", read)).elementIds).toEqual(line!.strokeIds);
    const range = ok(resolveTarget("T8 words 3-5", read));
    expect(range.address).toBe("T8 words 3–5");
    expect(range.elementIds).toEqual([3, 4, 5].flatMap((w) => strokesOfWord("T8", w)));
    expect(ok(resolveTarget("T8 words 5–3", read)).address).toBe("T8 words 3–5");
  });

  it("resolves a whole block, row or column", () => {
    const m8 = read.doc.items.find((i) => i.label === "M8")!;
    expect(ok(resolveTarget("M8", read)).elementIds).toEqual(m8.elementIds);
    expect(ok(resolveTarget("M8 row 1", read)).elementIds).toHaveLength(4);
    expect(ok(resolveTarget("M8 col 4", read)).elementIds).toContain(slip!.strokeIds[0]);
    expect(ok(resolveTarget("M8 column 4", read)).address).toBe("M8 col 4");
  });

  it("resolves a typed element by its label", () => {
    expect(ok(resolveTarget("X1", read))).toMatchObject({ address: "X1", elementIds: ["x1"] });
  });

  it("is lenient about case, commas and brackets", () => {
    for (const t of ["m8 row 1 col 4", "M8, row 1, col 4", "M8 (row 1, col 4)", " M8  row 1  column 4 "]) {
      expect(ok(resolveTarget(t, read)).address).toBe("M8 row 1 col 4");
    }
  });

  it("says what is wrong with an address it can't resolve", () => {
    expect(error(resolveTarget("T9", read))).toBe("no T9 on this canvas (its T labels are T1, T2, T3, T4, T5, T6, T7, T8)");
    expect(error(resolveTarget("N1", read))).toBe("no N1 on this canvas");
    expect(error(resolveTarget("M8 row 4 col 1", read))).toBe("M8 has 3 rows");
    expect(error(resolveTarget("M8 row 1 col 5", read))).toBe("M8 has 4 columns");
    expect(error(resolveTarget("T8 word 6", read))).toBe("T8 has 5 words");
    expect(error(resolveTarget("M8 word 2", read))).toBe(`M8 is a matrix: name a cell, like "M8 row 1 col 2"`);
    expect(error(resolveTarget("T8 row 1 col 1", read))).toBe(`T8 is a line of text, not a matrix: name a word, like "T8 word 2"`);
    expect(error(resolveTarget("X1 word 2", read))).toMatch(/^X1 is not handwriting/);
    expect(error(resolveTarget("the five", read))).toMatch(/^can't read "the five" as a place on the board/);
    expect(error(resolveTarget("M8 the 5", read))).toMatch(/^can't read "M8 the 5"/);
  });
});

describe("resolveTarget: points", () => {
  const mid = (b: { minX: number; minY: number; maxX: number; maxY: number }) => ({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });

  it("finds the cell or word a point lands in", () => {
    expect(ok(resolveTarget(mid(slip!.box), read))).toMatchObject({ address: "M8 row 1 col 4", elementIds: slip!.strokeIds });
    expect(ok(resolveTarget(mid(line!.box), read))).toMatchObject({ address: "T8 word 5", elementIds: line!.strokeIds });
  });

  it("falls back to the block between its cells, and to a placed element", () => {
    const m8 = read.doc.items.find((i) => i.label === "M8")!.box;
    expect(ok(resolveTarget({ x: slip!.box.minX - 30, y: mid(slip!.box).y }, read)).address).toBe("M8");
    expect(m8.minX).toBeLessThan(slip!.box.minX - 30);
    expect(ok(resolveTarget({ x: 1340, y: 410 }, read)).address).toBe("X1");
  });

  it("names the nearest thing when the point lands on nothing", () => {
    expect(error(resolveTarget({ x: 1600, y: 600 }, read))).toMatch(/^nothing is at \(1600, 600\); the nearest is X1, from \(1330, 400\) to/);
    expect(error(resolveTarget({ x: Number.NaN, y: 3 }, read))).toBe("a point needs a number for both x and y");
  });
});

describe("readCanvas: coordinates", () => {
  it("is off by default, and only adds the boxes when on", () => {
    const plain = readCanvas(elements, { render: "raw" }).text;
    expect(plain).not.toMatch(/Boxes of the/);
    const withBoxes = readCanvas(elements, { render: "raw", coordinates: true }).text;
    const stripped = withBoxes.split("\n\n").filter((s) => !s.startsWith("Boxes of the")).join("\n\n").replace(/\n- After each matrix and line of handwriting comes the box[^\n]*/, "");
    expect(stripped).toBe(plain);
  });

  it("prints a box for every cell and word, and the middle of each resolves back to it", () => {
    const text = readCanvas(elements, { coordinates: true }).text;
    const boxes = [...text.matchAll(/^([MT]\d+ (?:row \d+ col \d+|word \d+)): \((\d+), (\d+)\) to \((\d+), (\d+)\)$/gm)];
    // 8 matrices of 12 cells; the row operations' 6 + 6 + 6 + 4 + 6 + 6 + 6 words; T8's 5.
    expect(boxes).toHaveLength(8 * 12 + 40 + 5);
    for (const [, address, x1, y1, x2, y2] of boxes) {
      const p = { x: (Number(x1) + Number(x2)) / 2, y: (Number(y1) + Number(y2)) / 2 };
      expect(ok(resolveTarget(p, read)).address).toBe(address);
    }
  });
});
