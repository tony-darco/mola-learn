/**
 * The arithmetic the server checks on a board (lib/canvas/textSyntax/
 * checks.ts), for the canvas chat to mark by: row operations between the
 * steps of a matrix reduction, and numeric equations in handwriting, typed
 * text and LaTeX — and how an unsure reading keeps it from a confident
 * verdict. Then the section the model reads, on the annotate eval's boards.
 */
import { describe, expect, it } from "vitest";
import { CANVAS_CHAT_SYSTEM } from "../lib/canvas/chatTurn";
import { readCanvas } from "../lib/canvas/textSyntax";
import { checkBoard, checkPrinted, checksSection, formatNumber, withChecks, type Check, type EquationCheck, type Printed, type StepCheck } from "../lib/canvas/textSyntax/checks";
import { makeBoard } from "../evals/canvas-annotate/fixtures";
import { math, note, textBox } from "../evals/canvas-reader/fixtures";

const matrix = (label: string, rows: (string | number)[][]): Printed => ({ kind: "matrix", label, rows: rows.map((r) => r.map(String)) });
const line = (label: string, text: string): Printed => ({ kind: "words", label, words: text.split(" ") });
const steps = (checks: Check[]) => checks.filter((c): c is StepCheck => c.kind === "step");
const equations = (checks: Check[]) => checks.filter((c): c is EquationCheck => c.kind === "equation");
const equation = (text: string) => equations(checkPrinted([line("T1", text)]));

// The eval's reduction: x + y + z = 6, 2x + 3y + z = 11, x - y + 2z = 5.
const M1 = [[1, 1, 1, 6], [2, 3, 1, 11], [1, -1, 2, 5]];
const M2 = [[1, 1, 1, 6], [0, 1, -1, -1], [1, -1, 2, 5]];
const M3 = [[1, 1, 1, 6], [0, 1, -1, -1], [0, -2, 1, -1]];
const M4 = [[1, 1, 1, 6], [0, 1, -1, -1], [0, 0, -1, -3]];

describe("checks: row operations between matrices", () => {
  it("finds a step right when every entry follows from the one before", () => {
    const [step] = steps(checkPrinted([matrix("M1", M1), line("T1", "↓ R2 = R2 - 2R1"), matrix("M2", M2)]));
    expect(step).toMatchObject({ from: "M1", to: "M2", by: ["T1"], verdict: "right", op: "R2 = R2 - 2R1", wrong: [], unsure: [] });
  });

  it("names each entry a step gets wrong, with what the operation gives and what is written", () => {
    const wrongM2 = M2.map((r, i) => (i === 1 ? [0, 1, -1, 1] : r));
    const [step] = steps(checkPrinted([matrix("M1", M1), line("T1", "↓ R2 = R2 - 2R1"), matrix("M2", wrongM2)]));
    expect(step).toMatchObject({ verdict: "wrong", op: "R2 = R2 - 2R1", wrong: [{ address: "M2 row 2 col 4", gives: -1, written: "1" }] });
  });

  it("checks several steps in a row, each from the one before", () => {
    const checks = steps(checkPrinted([
      matrix("M1", M1), line("T1", "↓ R2 = R2 - 2R1"), matrix("M2", M2), line("T2", "↓ R3 = R3 - R1"), matrix("M3", M3),
      line("T3", "↓ R3 = R3 + 2R2"), matrix("M4", M4),
    ]));
    expect(checks.map((c) => [c.from, c.to, c.verdict, c.op])).toEqual([
      ["M1", "M2", "right", "R2 = R2 - 2R1"], ["M2", "M3", "right", "R3 = R3 - R1"], ["M3", "M4", "right", "R3 = R3 + 2R2"],
    ]);
  });

  it("reports only where a slip carried forward first goes wrong, and says the steps after it weren't checked", () => {
    // M2's row 2 col 4 is written 1 (should be -1); M3 and M4 carry it on, right from what is written but for it.
    const slipped = M2.map((r, i) => (i === 1 ? [0, 1, -1, 1] : r));
    const carried3 = M3.map((r, i) => (i === 1 ? [0, 1, -1, 1] : r));
    const carried4 = [[1, 1, 1, 6], [0, 1, -1, 1], [0, 0, -1, 1]];
    const checks = checkPrinted([
      matrix("M1", M1), line("T1", "R2 = R2 - 2R1"), matrix("M2", slipped), line("T2", "R3 = R3 - R1"), matrix("M3", carried3),
      line("T3", "R3 = R3 + 2R2"), matrix("M4", carried4),
    ]);
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ kind: "step", to: "M2", verdict: "wrong", wrong: [{ address: "M2 row 2 col 4" }], skipped: ["M3", "M4"] });
    expect(checksSection(checks)).toContain("- M2 row 2 col 4: R2 = R2 - 2R1 (T1) from M1 gives -1; written 1. The steps after it (M3, M4) build on M2 and weren't checked.");
  });

  it("reads scaling, swaps, fractions and arrows, and several operations on one line", () => {
    const scaled = steps(checkPrinted([matrix("M1", [[2, 4], [1, 3]]), line("T1", "R1 = (1/2)R1"), matrix("M2", [[1, 2], [1, 3]])]))[0];
    expect(scaled).toMatchObject({ verdict: "right", op: "R1 = 1/2R1" });
    const swapped = steps(checkPrinted([matrix("M1", [[0, 1], [1, 0]]), line("T1", "R1 ↔ R2"), matrix("M2", [[1, 0], [0, 1]])]))[0];
    expect(swapped).toMatchObject({ verdict: "right", op: "R1 ↔ R2" });
    const arrow = steps(checkPrinted([matrix("M1", [[1, 2], [3, 4]]), line("T1", "R2 - 3R1 → R2"), matrix("M2", [[1, 2], [0, -2]])]))[0];
    expect(arrow).toMatchObject({ verdict: "right", op: "R2 = R2 - 3R1" });
    const becomes = steps(checkPrinted([matrix("M1", [[1, 2], [3, 4]]), line("T1", "R2 → R2 − 3R1"), matrix("M2", [[1, 2], [0, -2]])]))[0];
    expect(becomes).toMatchObject({ verdict: "right", op: "R2 = R2 - 3R1" });
    const both = steps(checkPrinted([
      matrix("M1", [[1, 1, 1], [1, 2, 3], [1, 4, 9]]), line("T1", "R2 = R2 - R1, R3 = R3 - R1"), matrix("M2", [[1, 1, 1], [0, 1, 2], [0, 3, 8]]),
    ]))[0];
    expect(both).toMatchObject({ verdict: "right", op: "R2 = R2 - R1, R3 = R3 - R1" });
  });

  it("can't check a step whose operation it can't read, or whose matrices differ in size", () => {
    expect(steps(checkPrinted([matrix("M1", M1), line("T1", "R2 = swap it"), matrix("M2", M2)]))[0]).toMatchObject({ verdict: "unsure" });
    expect(steps(checkPrinted([matrix("M1", M1), line("T1", "R2 = R2 - 2R1"), matrix("M2", [[1, 1], [0, 1]])]))[0])
      .toMatchObject({ verdict: "unsure", unsure: ["M1 is 3 x 4 but M2 is 2 x 2"] });
    // Matrices with nothing written between them aren't a step.
    expect(checkPrinted([matrix("M1", M1), matrix("M2", M2)])).toEqual([]);
  });
});

describe("checks: unsure readings never give a confident verdict", () => {
  it("takes a written entry right if any reading of it agrees, and can't check it if none does", () => {
    const right = M2.map((r, i) => (i === 1 ? ["0", "«1|7»", "-1", "-1"] : r));
    expect(steps(checkPrinted([matrix("M1", M1), line("T1", "R2 = R2 - 2R1"), matrix("M2", right)]))[0]).toMatchObject({ verdict: "right" });
    const unclear = M2.map((r, i) => (i === 1 ? ["0", "1", "-1", "«5|S»"] : r));
    const [step] = steps(checkPrinted([matrix("M1", M1), line("T1", "R2 = R2 - 2R1"), matrix("M2", unclear)]));
    expect(step).toMatchObject({ verdict: "right", wrong: [], unsure: ["M2 row 2 col 4 is unclear («5|S»)"] });
    expect(checksSection([step!])).toContain("Can't check:\n- M2 row 2 col 4 is unclear («5|S»).");
  });

  it("doesn't call an entry wrong when what it is worked out from is unclear", () => {
    const unsureSource = M1.map((r, i) => (i === 1 ? ["2", "3", "1", "1«1|7»"] : r.map(String)));
    const wrongM2 = M2.map((r, i) => (i === 1 ? [0, 1, -1, 4] : r));
    const [step] = steps(checkPrinted([matrix("M1", unsureSource), line("T1", "R2 = R2 - 2R1"), matrix("M2", wrongM2)]));
    expect(step!.verdict).not.toBe("wrong");
    expect(step!.wrong).toEqual([]);
    expect(step!.unsure).toEqual(["M2 row 2 col 4 can't be worked out: an entry of M1 it comes from is unclear"]);
  });

  it("reads an unsure row number the only way that names a row", () => {
    expect(steps(checkPrinted([matrix("M2", M2), line("T2", "↓ R3 = R3 - R«1|7»"), matrix("M3", M3)]))[0]).toMatchObject({ verdict: "right", op: "R3 = R3 - R1" });
  });

  it("can't check a step an unsure character lets be read two ways, neither giving what is written", () => {
    const [step] = steps(checkPrinted([matrix("M1", [[1, 2], [3, 4]]), line("T1", "R2 = R2 - «2|7»R1"), matrix("M2", [[1, 2], [0, 0]])]));
    expect(step).toMatchObject({ verdict: "unsure", wrong: [] });
  });

  it("can't check an equation with an unsure character that one reading leaves no equation", () => {
    // The unclear character is on the right: what the left side comes to is certain, and says no reading of the right is it.
    expect(equation("2 + 2 = «5|S»")).toMatchObject([{ verdict: "unsure", place: "T1 word 5", why: "a character in it is unclear; the left side is 4, which no reading of the right side gives" }]);
    // Right one way: right.
    expect(equation("2 + 2 = «4|9»")).toMatchObject([{ verdict: "right" }]);
    // Wrong every way it may be read: still not said for sure, as what was written may be none of them.
    expect(equation("2 + 2 = «5|6»")).toMatchObject([{ verdict: "unsure", place: "T1 word 5", why: "a character in it is unclear; the left side is 4, which no reading of the right side gives" }]);
    // An unclear character in the left side leaves it unsaid.
    expect(equation("«2|z» + 2 = 5")).toMatchObject([{ verdict: "unsure", why: "a character in it is unclear" }]);
    expect(equation("«2|z» + 2 = 5")[0]!.place).toBeUndefined();
    expect(equation("«2|3» + 2 = 5")).toMatchObject([{ verdict: "right" }]);
    expect(equation("«2|8» + 2 = 5")).toMatchObject([{ verdict: "unsure", why: "a character in it is unclear" }]);
  });
});

describe("checks: equations", () => {
  it("finds a wrong sum, and names the word to mark and what the left side is", () => {
    expect(equation("2 + 2 = 5")).toEqual([{
      kind: "equation", label: "T1", from: 1, to: 5, text: "2 + 2 = 5", verdict: "wrong", place: "T1 word 5", why: "the left side is 4, not 5",
    }]);
    expect(equation("2 + 2 = 4")).toMatchObject([{ verdict: "right" }]);
  });

  it("works out products, quotients, powers, brackets and fractions, and takes a decimal to its places", () => {
    expect(equation("3 × 4 = 12")).toMatchObject([{ verdict: "right" }]);
    expect(equation("12 ÷ 4 = 4")).toMatchObject([{ verdict: "wrong", why: "the left side is 3, not 4" }]);
    expect(equation("2^3 - (1 + 1) = 6")).toMatchObject([{ verdict: "right" }]);
    expect(equation("1/3 = 0.33")).toMatchObject([{ verdict: "right" }]);
    expect(equation("1/4 + 1/4 = 0.6")).toMatchObject([{ verdict: "wrong", why: "the left side is 1/2, not 0.6" }]);
    expect(equation("2+2=3+3")).toMatchObject([{ verdict: "wrong", why: "the left side is 4, but 3+3 is 6" }]);
    expect(equation("-3 + 5 = 2")).toMatchObject([{ verdict: "right" }]);
  });

  it("finds equations inside a sentence, each on its own, and a wrong link in a chain", () => {
    const found = equation("this is a test: 3 + 4 = 7 and 2+2=5.");
    expect(found.map((e) => [e.text, e.verdict, e.place ?? null])).toEqual([["3 + 4 = 7", "right", null], ["2+2=5.", "wrong", "T1 word 11"]]);
    expect(equation("2 + 3 = 5 = 4 + 2")).toMatchObject([{ verdict: "wrong", place: "T1 words 7–9", why: "5 is 5, but 4 + 2 is 6" }]);
  });

  it("leaves alone what isn't a numeric equation: letters, a number alone on a side, row operations, digit groups", () => {
    for (const text of ["x + 2 = 5", "2x + 3 = 7", "x + 2 + 3 = 5", "y = 2 + 3", "f(2) = 4", "5 = 5", "page 12", "1,000 + 1 = 1,001"]) {
      expect(equation(text), text).toEqual([]);
    }
    // A line written between matrices as a row operation is checked as one, not as an equation.
    expect(checkPrinted([line("T1", "R1 = R1 - R2")])).toEqual([]);
  });

  it("checks typed text, sticky notes and LaTeX, by their words", () => {
    const elements = [
      textBox("t", 0, 0, "check: 6 * 7 = 41"), note("n", 300, 0, "10 - 3 = 7"),
      math("q1", 0, 100, "\\frac{12}{4} = 4"), math("q2", 0, 200, "6 \\times 7 = 42"), math("q3", 0, 300, "x^{2} = 4"),
    ];
    const read = readCanvas(elements);
    const found = equations(checkBoard(elements, read.doc));
    expect(found.map((e) => [e.label, e.verdict, e.place ?? null, e.why ?? null])).toEqual([
      ["X1", "wrong", "X1 word 6", "the left side is 42, not 41"],
      ["Q1", "wrong", "Q1 word 3", "the left side is 3, not 4"],
      ["Q2", "right", null, null],
      ["N1", "right", null, null],
    ]);
  });
});

describe("checks: the section the model reads", () => {
  it("lists the mistakes on the annotate eval's board, what is right, and nothing else", () => {
    const b = makeBoard("clean");
    const read = readCanvas(b.elements);
    const section = checksSection(checkBoard(b.elements, read.doc))!;
    expect(section.split("\n")).toEqual([
      "ARITHMETIC CHECKED",
      "Worked out exactly from the board as read above: every matrix with row operations written between it and the matrix before it, "
        + "and every equation with numbers on both sides. Nothing else was checked.",
      "Mistakes:",
      "- M8 row 1 col 4: R1 = R1 - R2 (T7) from M7 gives 1; written 5.",
      "- T8 word 5: 2 + 2 = 5 (T8 words 1–5) — the left side is 4, not 5.",
      "Right:",
      "- M2: every entry follows from M1 by R2 = R2 - 2R1 (T1).",
      "- M3: every entry follows from M2 by R3 = R3 - R1 (T2).",
      "- M4: every entry follows from M3 by R3 = R3 + 2R2 (T3).",
      "- M5: every entry follows from M4 by R3 = -R3 (T4).",
      "- M6: every entry follows from M5 by R2 = R2 + R3 (T5).",
      "- M7: every entry follows from M6 by R1 = R1 - R3 (T6).",
    ]);
    // After the board, which reads as it did.
    expect(withChecks(read, b.elements)).toBe(`${read.text}\n\n${section}`);
  });

  it("finds the matrix slip in every hand, and says when it can't check the sum", () => {
    for (const name of ["jitter1", "jitter2"] as const) {
      const b = makeBoard(name);
      const checks = checkBoard(b.elements, readCanvas(b.elements).doc);
      expect(steps(checks).filter((c) => c.verdict === "wrong").flatMap((c) => c.wrong.map((w) => [w.address, w.gives, w.written]))).toEqual([["M8 row 1 col 4", 1, "5"]]);
      expect(steps(checks).filter((c) => c.verdict === "right")).toHaveLength(6);
    }
    const jitter1 = makeBoard("jitter1");
    expect(checksSection(checkBoard(jitter1.elements, readCanvas(jitter1.elements).doc))).toContain("Can't check:\n- T8 word 5: 2 + 2 = «5|S» (T8 words 1–5) — a character in it is unclear; the left side is 4, which no reading of the right side gives.");
  });

  it("finds the typed board's mistakes at their words", () => {
    const b = makeBoard("typed");
    const wrong = equations(checkBoard(b.elements, readCanvas(b.elements).doc)).filter((e) => e.verdict === "wrong").map((e) => e.place);
    expect(wrong).toEqual(b.errors.map((e) => e.address));
  });

  it("checks, in a read of a selected region, only what was read in full — and no step across what wasn't", () => {
    const b = makeBoard("clean");
    const wrongOf = (region: { minX: number; minY: number; maxX: number; maxY: number }) => {
      const read = readCanvas(b.elements, { region });
      return [steps(checkBoard(b.elements, read.doc)).map((c) => [c.from, c.to, c.verdict]), withChecks(read, b.elements)] as const;
    };
    // M7, the row operation T7 and M8 all inside: the step between them is checked, and its slip found.
    const [whole, text] = wrongOf({ minX: 780, minY: 440, maxX: 1220, maxY: 840 });
    expect(whole).toEqual([["M7", "M8", "wrong"]]);
    expect(text).toContain("- M8 row 1 col 4: R1 = R1 - R2 (T7) from M7 gives 1; written 5.");
    // M7 and M8 cut through, only some of their cells printed: nothing is said of cells the model wasn't shown.
    const [cut, cutText] = wrongOf({ minX: 780, minY: 600, maxX: 1220, maxY: 760 });
    expect(cut).toEqual([]);
    expect(cutText).not.toContain("ARITHMETIC CHECKED");
  });

  it("says nothing when there is nothing to check", () => {
    const elements = [textBox("t", 0, 0, "hello there")];
    const read = readCanvas(elements);
    expect(checksSection(checkBoard(elements, read.doc))).toBeNull();
    expect(withChecks(read, elements)).toBe(read.text);
  });

  it("is what the system prompt tells the model to mark by", () => {
    expect(CANVAS_CHAT_SYSTEM).toContain("ARITHMETIC CHECKED");
    expect(CANVAS_CHAT_SYSTEM).toContain("in worked steps mark only where it first goes wrong");
  });

  it("writes numbers plainly", () => {
    expect([4, -0.5, 1 / 3, 0.1 + 0.2, Math.SQRT2].map(formatNumber)).toEqual(["4", "-1/2", "1/3", "3/10", "1.4142"]);
  });
});
