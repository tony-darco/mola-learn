/**
 * Stage A of the canvas-syntax eval, as a guard: segmenting the handwritten
 * matrix reduction must recover exactly the structure that was written — on
 * the clean strokes and on several jittered hands — and the recognizer must
 * keep reading the characters as well as it did when it was tuned. (Stage B,
 * whether models can read the result, lives in evals/canvas-syntax and is
 * not a test.)
 */
import { describe, expect, it } from "vitest";
import { canvasHandwritingToText } from "../lib/canvas/textSyntax";
import { makeFixture } from "../evals/canvas-syntax/fixtures";
import { scoreNormalized, scoreStageA, type StageAMetrics } from "../evals/canvas-syntax/score";

const perfect = (m: StageAMetrics): StageAMetrics => ({
  matrices: { ...m.matrices, found: m.matrices.expected, matched: m.matrices.expected },
  shapes: { ...m.shapes, correct: m.shapes.expected },
  glyphs: { ...m.glyphs, correct: m.glyphs.expected },
  cells: { ...m.cells, correct: m.cells.expected },
  texts: { ...m.texts, correct: m.texts.expected },
});

const cases: [string, number | undefined][] = [["clean", undefined], ...[1, 2, 3, 4, 5].map((s): [string, number] => [`jitter seed ${s}`, s])];

describe("canvas handwriting segmentation (Stage A)", () => {
  it.each(cases)("%s: every matrix, cell, glyph, and label comes out exactly as written", (name, seed) => {
    const { plan, elements } = makeFixture(name, seed);
    const { doc } = canvasHandwritingToText(elements);
    const { metrics, mapping } = scoreStageA(plan, doc);

    expect(metrics.matrices.expected).toBe(8);
    expect(metrics.texts.expected).toBe(7);
    expect(metrics).toEqual(perfect(metrics));
    // Reading order numbers the blocks the way the steps were written.
    expect(mapping.matrix).toEqual(plan.steps.map((_, i) => `M${i + 1}`));
    expect(mapping.text).toEqual(plan.steps.map((s, i) => (s.label === null ? null : `T${i + 1}`)));
  });
});

describe("canvasHandwritingToText", () => {
  it.each(["raw", "normalized"] as const)("is deterministic (%s)", (render) => {
    const a = canvasHandwritingToText(makeFixture("a", 1).elements, { render }).text;
    const b = canvasHandwritingToText(makeFixture("b", 1).elements, { render }).text;
    expect(a).toBe(b);
  });

  it("keeps a minus sign in the middle rows of its line and \"=\" as two runs", () => {
    const { text } = canvasHandwritingToText(makeFixture("clean").elements);
    // M1 row 3 col 2 is "-1"; T1 word 3 is "=".
    const bitmap = (title: string) => text.split(`${title}\n`)[1]!.split("\n\n")[0]!.split("\n");
    const minus = bitmap("M1 row 3 col 2").map((line) => line.split(" ")[0]!);
    expect(minus).toHaveLength(9);
    expect(minus.map((row, r) => (row.includes("#") ? r : -1)).filter((r) => r >= 0)).toEqual([4]);
    const equals = bitmap("T1 word 3");
    expect(equals.filter((row) => row.includes("#"))).toHaveLength(2);
  });
});

describe("character recognition (Stage A, normalized)", () => {
  const read = (seed?: number) => {
    const { plan, elements } = makeFixture("fixture", seed);
    const { doc } = canvasHandwritingToText(elements);
    return scoreNormalized(plan, doc, scoreStageA(plan, doc).mapping);
  };

  it("reads the clean hand perfectly, with nothing left uncertain", () => {
    const m = read();
    expect(m.glyphs).toEqual({ expected: 174, correct: 174, fallback: 0, confidentWrong: 0 });
    expect(m.cells).toEqual({ expected: 96, correct: 96 });
    expect(m.texts).toEqual({ expected: 7, correct: 7 });
  });

  it("reads the held-out jittered hands (seeds 100–149) as well as when it was tuned, and never misreads without flagging", () => {
    // The recognizer was tuned on jitter seeds 1–20 only; seeds 100–149 were
    // first looked at once tuning was final. Measured then: characters
    // 8698/8700, cells 4800/4800, text lines 346/350, 49 glyphs flagged
    // (0.6%), and no misread left unflagged — the two misses were a "1"
    // whose flag had flattened into a "7"'s top bar (flagged) and an "R" that
    // segmentation split in two. The floors sit just under that. A confident
    // misread is the one failure that isn't allowed at all: a glyph the
    // recognizer isn't sure of must come out flagged. The cap on flags keeps
    // that from being met by flagging everything. If recognition improves,
    // tighten them.
    const total = { glyphs: 0, correct: 0, flagged: 0, confidentWrong: 0, cells: 0, cellsCorrect: 0, texts: 0, textsCorrect: 0 };
    for (let seed = 100; seed <= 149; seed++) {
      const m = read(seed);
      total.glyphs += m.glyphs.expected;
      total.correct += m.glyphs.correct;
      total.flagged += m.glyphs.fallback;
      total.confidentWrong += m.glyphs.confidentWrong;
      total.cells += m.cells.expected;
      total.cellsCorrect += m.cells.correct;
      total.texts += m.texts.expected;
      total.textsCorrect += m.texts.correct;
    }
    expect(total.confidentWrong).toBe(0);
    expect(total.correct / total.glyphs).toBeGreaterThanOrEqual(0.999);
    expect(total.cellsCorrect / total.cells).toBeGreaterThanOrEqual(0.999);
    expect(total.textsCorrect / total.texts).toBeGreaterThanOrEqual(0.98);
    expect(total.flagged / total.glyphs).toBeLessThanOrEqual(0.01);
  }, 60_000);
});
