/**
 * Words in typed text (lib/canvas/wordTargets.ts, targets.ts): "X1 word 11"
 * names the 11th word of a text box, "N1 words 2–3" some of a sticky note's,
 * "Q1 word 3" a piece of math's LaTeX — and annotate_canvas places a mark on
 * one. The server only knows the element, so the mark goes on all of it,
 * under the words' address; the page finds the words (the measuring is the
 * annotate e2e's: e2e/canvas-annotate.spec.ts).
 */
import { describe, expect, it } from "vitest";
import { annotate, newAnnotateTurn, type AnnotateBoard } from "../lib/canvas/annotate";
import { latexWordRange, targetWords, typedWords, typedWordSpans, visibleLatex } from "../lib/canvas/wordTargets";
import { readCanvas, resolveTarget, type ResolvedTarget } from "../lib/canvas/textSyntax";
import { math, note, textBox } from "../evals/canvas-reader/fixtures";

const SENTENCE = "this is a test: 3 + 4 = 7 and 2+2=5";
const elements = [textBox("x", 100, 100, SENTENCE, { width: 380 }), note("n", 600, 100, "Remember: 10 - 3 = 7"), math("q", 100, 300, "12 \\div 4 = 4")];
const read = readCanvas(elements);
const board: AnnotateBoard = { elements, doc: read.doc };
const annotation = (target: string, kind = "error") => ({ target, kind, mark: "box", note: "Not this." });
const placed = (...annotations: unknown[]) => annotate({ annotations }, board, newAnnotateTurn());

const ok = (r: ResolvedTarget) => {
  if (!r.ok) throw new Error(r.error);
  return r;
};
const error = (r: ResolvedTarget) => (r.ok ? `resolved to ${r.address}` : r.error);

describe("words of typed text", () => {
  it("are what is between spaces, counted from 1, with where each starts and ends", () => {
    expect(typedWords(SENTENCE)).toHaveLength(11);
    expect(typedWords(SENTENCE)[10]).toBe("2+2=5");
    expect(typedWordSpans("a  bc\nd")).toEqual([{ word: "a", start: 0, end: 1 }, { word: "bc", start: 3, end: 5 }, { word: "d", start: 6, end: 7 }]);
    expect(typedWords("   ")).toEqual([]);
  });

  it("are named in an address by one word or a range, either way round", () => {
    expect(targetWords("X1 word 11")).toEqual([11, 11]);
    expect(targetWords("X1 words 3–5")).toEqual([3, 5]);
    expect(targetWords("Q2 words 5-3")).toEqual([3, 5]);
    expect(targetWords("X1")).toBeNull();
    expect(targetWords("M1 row 2 col 3")).toBeNull();
  });
});

describe("resolveTarget: words of typed text", () => {
  it("resolves a word of a text box, sticky note or math to its element, under the word's address", () => {
    expect(ok(resolveTarget("X1 word 11", { ...read, elements }))).toMatchObject({ address: "X1 word 11", elementIds: ["x"] });
    expect(ok(resolveTarget("N1 words 2-3", { ...read, elements }))).toMatchObject({ address: "N1 words 2–3", elementIds: ["n"] });
    expect(ok(resolveTarget("Q1 word 5", { ...read, elements }))).toMatchObject({ address: "Q1 word 5", elementIds: ["q"] });
    const whole = ok(resolveTarget("X1", read));
    expect(ok(resolveTarget("x1, word 3", { ...read, elements })).box).toEqual(whole.box);
  });

  it("says how many words there are, and what a typed element has instead of rows and columns", () => {
    const withElements = { ...read, elements };
    expect(error(resolveTarget("X1 word 12", withElements))).toBe("X1 has 11 words, counted between spaces");
    expect(error(resolveTarget("X1 word 0", withElements))).toBe("X1 has 11 words, counted between spaces");
    expect(error(resolveTarget("X1 row 1 col 2", withElements))).toBe(`X1 is typed, so it has no rows or columns: name a word, like "X1 word 2", or all of it, as "X1"`);
  });

  it("can't tell a word without the board's elements, and keeps refusing the handwriting words it always did", () => {
    expect(error(resolveTarget("X1 word 2", read))).toMatch(/^X1 is not handwriting/);
    expect(error(resolveTarget("T1 word 2", { ...read, elements }))).toMatch(/^no T1 on this canvas/);
  });
});

describe("annotate_canvas: words of typed text", () => {
  it("places an annotation on the word's address, on the whole element, naming it as targetIds", () => {
    const [k] = placed(annotation("X1 word 11")).placed;
    const x = elements[0]!;
    expect(k).toMatchObject({
      type: "annotation", x: x.x, y: x.y, width: x.width, height: x.height,
      props: { kind: "error", target: "X1 word 11", targetIds: ["x"] },
    });
  });

  it("asks once for the word when an error is on all of a text box, sticky note or math of several words", () => {
    const turn = newAnnotateTurn();
    const first = annotate({ annotations: [annotation("X1"), annotation("N1"), annotation("Q1")] }, board, turn);
    expect(first.placed).toEqual([]);
    expect(first.result).toContain(`- annotation 1 ("X1"): X1 is a whole text box of 11 words: point at the word or words that are wrong, as "X1 word …" or "X1 words …–…", counting words between spaces`);
    expect(first.result).toContain(`- annotation 2 ("N1"): N1 is a whole sticky note of 6 words`);
    expect(first.result).toContain(`- annotation 3 ("Q1"): Q1 is a whole math element of 5 words`);
    // Sent again unchanged, it is placed; a hint on all of it never was asked about.
    expect(annotate({ annotations: [annotation("X1")] }, board, turn).placed.map((e) => e.props.target)).toEqual(["X1"]);
    expect(placed(annotation("N1", "hint")).placed.map((e) => e.props.target)).toEqual(["N1"]);
  });

  it("takes all of a one-word text box straight away, and sends back a word that isn't there", () => {
    const one = [textBox("x", 100, 100, "hello")];
    const r = annotate({ annotations: [annotation("X1")] }, { elements: one, doc: readCanvas(one).doc }, newAnnotateTurn());
    expect(r.placed.map((e) => e.props.target)).toEqual(["X1"]);
    expect(placed(annotation("X1 word 12")).result).toContain(`- annotation 1 ("X1 word 12"): X1 has 11 words, counted between spaces`);
  });

  it("reads back, as K1, where it is: the words, and that they're still there", () => {
    const [k] = placed(annotation("X1 word 11")).placed;
    const withK = readCanvas([...elements, k!], { labels: read.labels });
    expect(withK.text).toContain("X1 word 11");
    expect(withK.text).not.toContain("no longer on the board");
  });
});

describe("where KaTeX draws a word of LaTeX", () => {
  it("is what it draws for each piece: signs and operators as they look, structure not at all", () => {
    expect(visibleLatex("12")).toBe("12");
    expect(visibleLatex("\\div")).toBe("÷");
    expect(visibleLatex("-")).toBe("−");
    expect(visibleLatex("\\frac{1}{2}")).toBe("12");
    expect(visibleLatex("x^{2}")).toBe("x2");
    expect(visibleLatex("\\mystery")).toBeNull();
  });

  it("finds a word's characters among all that were drawn, or says it can't", () => {
    const drawn = "12÷4=4";
    expect(latexWordRange("12 \\div 4 = 4", drawn, 5, 5)).toEqual({ start: 5, length: 1 });
    expect(latexWordRange("12 \\div 4 = 4", drawn, 1, 3)).toEqual({ start: 0, length: 4 });
    // What was drawn isn't what the LaTeX says would be, or the word isn't there.
    expect(latexWordRange("12 \\div 4 = 4", "12÷4=5", 5, 5)).toBeNull();
    expect(latexWordRange("12 \\div 4 = 4", drawn, 6, 6)).toBeNull();
    expect(latexWordRange("1 \\mystery 2", "12", 1, 1)).toBeNull();
  });
});
