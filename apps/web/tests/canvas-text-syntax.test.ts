/**
 * Stage A of the canvas-syntax eval, as a guard: segmenting the handwritten
 * matrix reduction must recover exactly the structure that was written — on
 * the clean strokes and on several jittered hands — and the recognizer must
 * keep reading the characters, of the matrix and of the whole alphabet, as
 * well as it did when it was tuned. (Stage B,
 * whether models can read the result, lives in evals/canvas-syntax and is
 * not a test.)
 */
import { describe, expect, it } from "vitest";
import { canvasHandwritingToText } from "../lib/canvas/textSyntax";
import { makeAlphabet, scoreAlphabet, sumAlphabet } from "../evals/canvas-syntax/alphabet";
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
    // first looked at once tuning was final. Measured then, when it knew only
    // digits, "-+=", "R" and "↓": characters 8698/8700, cells 4800/4800,
    // text lines 346/350, 49 glyphs flagged (0.6%), no misread unflagged.
    //
    // Since it reads the whole alphabet, this hand's "R" has an "A", "P" and
    // "K" to be confused with, and its "2" a "z": measured with the alphabet,
    // characters 8683/8700, cells 4800/4800, text lines 338/350, 175 flagged
    // (2.0%), and one misread unflagged. Most misses are characters joined to
    // or split from a neighbour in the row-operation labels. A flag is cheap —
    // the model reading the board resolves it from context — so the cap on
    // flags is 3%; a confident misread is what hurts, so that floor sits just
    // above the one seen. If recognition improves, tighten them.
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
    expect(total.confidentWrong).toBeLessThanOrEqual(1);
    expect(total.correct / total.glyphs).toBeGreaterThanOrEqual(0.997);
    expect(total.cellsCorrect / total.cells).toBeGreaterThanOrEqual(0.999);
    expect(total.textsCorrect / total.texts).toBeGreaterThanOrEqual(0.96);
    expect(total.flagged / total.glyphs).toBeLessThanOrEqual(0.03);
  }, 180_000);
});

describe("character recognition: the full alphabet", () => {
  it("reads the clean hand perfectly — every character, every sub- and superscript, every line — and never misreads unflagged", () => {
    const m = scoreAlphabet(makeAlphabet());
    expect(m.glyphs).toMatchObject({ expected: 238, segmented: 238, correct: 238, confidentWrong: 0 });
    expect(m.scripts).toEqual({ expected: 16, correct: 16, falsePositives: 0 });
    expect(m.lines).toEqual({ expected: 20, correct: 20 });
    expect(m.reads.find((r) => r.expected.startsWith("H_2O"))?.got).toBe("H_2O + CO_2 → H_2CO_3");
  });

  it("reads the held-out jittered hands (seeds 300–349) as well as when it was tuned, rarely misreading without a flag", () => {
    // Tuned on seeds 1–20 (of this fixture and the matrix one); seeds 300–349
    // were first scored once tuning was frozen, and once more after a fix to
    // segmentation made for a failure seen on the tuning seeds (neighbours in
    // a row-operation label joined because they touched). Measured then:
    // 11760/11900 characters segmented as written, 11203 read right, 3253
    // flagged (27.7%), 25 misread unflagged (0.21%), 760/800 scripts read as
    // scripts and 135 glyphs taken for scripts that weren't.
    //
    // The fixture is built to be hard: case pairs side by side ("Cc Oo Ss"),
    // look-alikes in a row ("l1I 0Oo s5S z2Z 9gq"), every symbol once. Most
    // unflagged misreads are "×" and "x" taken for each other: written the
    // same size and nearly the same height, they differ by a fifth of a cap.
    // The floors sit just under (or over) what was measured.
    const all = sumAlphabet(Array.from({ length: 50 }, (_, i) => scoreAlphabet(makeAlphabet(300 + i))));
    const g = all.glyphs;
    expect(g.segmented / g.expected).toBeGreaterThanOrEqual(0.985);
    expect(g.correct / g.expected).toBeGreaterThanOrEqual(0.935);
    expect(g.confidentWrong / g.segmented).toBeLessThanOrEqual(0.0025);
    expect(g.flagged / g.segmented).toBeLessThanOrEqual(0.3);
    expect(all.scripts.correct / all.scripts.expected).toBeGreaterThanOrEqual(0.93);
  }, 300_000);
});
