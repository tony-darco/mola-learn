/**
 * The canvas chat's edit log (lib/canvas/editLog.ts): the changes between
 * two boards, told by label, and how a run of saves folds into entries —
 * a matrix written stroke by stroke, a cell rewritten, writing erased,
 * things moved, typed text and math added and edited, arrows drawn.
 * The log as rows in a chat, with messages in between, is
 * canvas-edit-log-sync.test.ts.
 */
import { describe, expect, it } from "vitest";
import type { CanvasElement } from "@mola/shared";
import { readCanvas, type LabelMap } from "../lib/canvas/textSyntax";
import {
  describeCanvasChanges, describeEdit, diffSnapshots, mergeEdit, snapshotBoard, type BoardSnapshot, type CanvasEdit,
} from "../lib/canvas/editLog";
import { drawn, line, math, textBox, written } from "../evals/canvas-reader/fixtures";
import { planElements } from "../evals/canvas-syntax/fixtures";
import { planMatrixReduction, type MatrixPlan, type StrokeMeta } from "../e2e/support/matrixPlan";
import { arrowStrokes } from "../e2e/support/strokeFont";

/** The sentences for the changes from `before` to `after`, both read fresh. */
const changes = (before: CanvasElement[], after: CanvasElement[]) => describeCanvasChanges(before, after).edits.map((e) => describeEdit(e));

/**
 * The log a chat would hold after these boards were saved one after another,
 * the first as it stood when the chat began (so nothing on it is logged):
 * every save diffed against the one before, with the labels carried along,
 * and folded into the newest entry when it carries on from it.
 */
function logOf(boards: CanvasElement[][]): string[] {
  let labels: LabelMap | undefined;
  let before: BoardSnapshot | null = null;
  const log: CanvasEdit[] = [];
  for (const board of boards) {
    const read = readCanvas(board, { labels });
    labels = read.labels;
    const snapshot = snapshotBoard(board, read.doc);
    for (const edit of before ? diffSnapshots(before, snapshot) : []) {
      const merged = log.length > 0 ? mergeEdit(log[log.length - 1]!, edit) : null;
      if (merged) log[log.length - 1] = merged;
      else log.push(edit);
    }
    before = snapshot;
  }
  return log.map((e) => describeEdit(e));
}

/** An empty board, then one more stroke saved each time. */
const strokeByStroke = (elements: CanvasElement[]) => [[], ...elements.map((_, i) => elements.slice(0, i + 1))];

/** The matrix reduction's first `steps` steps, each a matrix with the row operation written under it. */
function reduction(steps: number, plan: MatrixPlan = planMatrixReduction()) {
  const elements = planElements(plan);
  const keep = (m: StrokeMeta) => m.step < steps;
  return { elements: elements.filter((_, i) => keep(plan.meta[i]!)), meta: plan.meta.filter(keep) };
}

describe("the edit log: a matrix written stroke by stroke", () => {
  /** The first two steps of the reduction: two 3×4 matrices, each with its row operation under it. */
  const expected = [
    /^You added M\d+ \(a 3×4 matrix\)/,
    /^You wrote T\d+: "↓ R2 = R2 - 2R1"$/,
    /^You added M\d+ \(a 3×4 matrix\)$/,
    /^You wrote T\d+: "↓ R3 = R3 - R1"$/,
  ];

  it.each([["the clean hand", undefined], ["jitter seed 1", 1], ["jitter seed 3", 3]])("%s: one entry per matrix and per line, however many saves", (_, seed) => {
    const log = logOf(strokeByStroke(reduction(2, planMatrixReduction({ jitterSeed: seed })).elements));
    // A bracket on its own reads as a character until the matrix forms; at most one such entry is left behind it.
    const rest = log.filter((l) => !/^You wrote T\d+: "[^"]{1,2}"$/.test(l));
    expect(log.length - rest.length).toBeLessThanOrEqual(1);
    expect(rest).toHaveLength(expected.length);
    rest.forEach((l, i) => expect(l).toMatch(expected[i]!));
    // What the matrix took in along the way is named only if the log told it first.
    if (log.length > rest.length) expect(rest[0]).toMatch(/; T\d+ is now part of it$/);
    else expect(rest[0]).toMatch(/matrix\)$/);
  });
});

describe("the edit log: changes to a board", () => {
  const { elements: board, meta } = reduction(1);
  const strokesOf = (pick: (m: StrokeMeta) => boolean) => board.filter((_, i) => pick(meta[i]!));
  const isCell = (row: number, col: number) => (m: StrokeMeta) => m.role === "glyph" && m.place.kind === "cell" && m.place.row === row && m.place.col === col;
  const isLabel = (m: StrokeMeta) => m.role === "glyph" && m.place.kind === "label";

  it("a single entry rewritten", () => {
    // Row 2 col 3 erased and written again as 5, in one save: the slipped reduction has it at the same place.
    const slip = reduction(1, planMatrixReduction({ slip: { step: 0, row: 1, col: 2, value: 5 } }));
    const five = slip.elements.filter((_, i) => isCell(1, 2)(slip.meta[i]!)).map((e, i) => ({ ...e, id: `new${i}` }));
    const after = [...board.filter((e) => !strokesOf(isCell(1, 2)).includes(e)), ...five];
    expect(changes(board, after)).toEqual(["You changed M1 row 2 col 3 from 1 to 5"]);
  });

  it("an entry erased, then written again, in two saves: one entry", () => {
    const slip = reduction(1, planMatrixReduction({ slip: { step: 0, row: 1, col: 2, value: 5 } }));
    const five = slip.elements.filter((_, i) => isCell(1, 2)(slip.meta[i]!)).map((e, i) => ({ ...e, id: `new${i}` }));
    const erased = board.filter((e) => !strokesOf(isCell(1, 2)).includes(e));
    expect(logOf([board, erased])).toEqual(["You changed M1 row 2 col 3 from 1 to empty"]);
    expect(logOf([board, erased, [...erased, ...five]])).toEqual(["You changed M1 row 2 col 3 from 1 to 5"]);
  });

  it("writing erased", () => {
    const after = board.filter((e) => !strokesOf(isLabel).includes(e));
    expect(changes(board, after)).toEqual([`You erased T1: "↓ R2 = R2 - 2R1"`]);
  });

  it("a matrix erased", () => {
    const after = strokesOf(isLabel);
    expect(changes(board, after)).toEqual(["You erased M1 (a 3×4 matrix)"]);
  });

  it("a matrix moved: every stroke of it, together", () => {
    const ofMatrix = new Set(strokesOf((m) => !isLabel(m)));
    const after = board.map((e) => (ofMatrix.has(e) ? { ...e, x: e.x + 600, y: e.y + 40 } : e));
    expect(changes(board, after)).toEqual(["You moved M1"]);
  });

  it("a text box moved, and moved again: one entry", () => {
    const at = (x: number) => [textBox("t", x, 100, "pivot first")];
    expect(changes(at(100), at(300))).toEqual(["You moved X1"]);
    expect(logOf([at(100), at(200), at(300)])).toEqual(["You moved X1"]);
  });

  it("typed text added, edited, deleted", () => {
    const typed = (text: string) => [textBox("t", 100, 100, text)];
    expect(changes([], typed("x + 2"))).toEqual([`You added a text box X1: "x + 2"`]);
    expect(changes(typed("x + 2"), typed("x + 2 = 5"))).toEqual([`You changed X1 from "x + 2" to "x + 2 = 5"`]);
    expect(changes(typed("x + 2 = 5"), [])).toEqual([`You deleted X1: "x + 2 = 5"`]);
    expect(changes(typed("one"), [textBox("t", 100, 100, "one\ntwo")])).toEqual([`You changed X1 from "one" to "one / two"`]);
  });

  it("math added and edited", () => {
    const latex = (s: string) => [math("q", 100, 100, s)];
    expect(changes([], latex("x^2"))).toEqual([`You added math Q1: "x^2"`]);
    expect(changes(latex("x^2"), latex("\\frac{x^2}{2}"))).toEqual([`You changed Q1 from "x^2" to "\\frac{x^2}{2}"`]);
  });

  it("a restyled element is not a change the log tells", () => {
    const before = [textBox("t", 100, 100, "same words")];
    const after = before.map((e) => (e.type === "text" ? { ...e, props: { ...e.props, color: "#ff0000", bold: true } } : e));
    expect(changes(before, after)).toEqual([]);
  });

  it("an arrow drawn with the arrow tool from one matrix to another", () => {
    const two = reduction(2).elements;
    expect(changes(two, [...two, line("arrow", { x: 700, y: 180 }, { x: 700, y: 360 }, "end")])).toEqual(["You drew an arrow A1 from M1 to M2"]);
  });

  it("an arrow drawn with the pen, between two lines of writing", () => {
    const lines = [...written("a", "R1", 100, 100, 30), ...written("b", "R2", 100, 300, 30)];
    const arrow = arrowStrokes({ x: 115, y: 140 }, { x: 115, y: 290 }, "separate").map((s, i) => drawn(`arrow${i}`, s));
    expect(changes(lines, [...lines, ...arrow])).toEqual(["You drew an arrow A1 from T1 to T2"]);
  });

  it("an arrow's head dragged to something else", () => {
    const boxes = [textBox("a", 100, 100, "left", { width: 60 }), textBox("b", 400, 100, "right", { width: 60 }), textBox("c", 400, 300, "below", { width: 60 })];
    const before = [...boxes, line("l", { x: 165, y: 112 }, { x: 395, y: 112 }, "end")];
    const after = [...boxes, line("l", { x: 165, y: 112 }, { x: 395, y: 312 }, "end")];
    expect(changes(before, after)).toEqual(["You changed A1, now from X1 to X3"]);
  });

  it("several changes in one save: what was erased first, then the rest in reading order", () => {
    const before = [textBox("a", 100, 100, "first"), textBox("b", 100, 300, "second")];
    const after = [textBox("b", 100, 300, "second, edited"), math("q", 100, 500, "y = mx + b")];
    expect(changes(before, after)).toEqual([
      `You deleted X1: "first"`,
      `You changed X2 from "second" to "second, edited"`,
      `You added math Q1: "y = mx + b"`,
    ]);
  });
});

describe("the edit log: folding a change into the newest entry", () => {
  it("handwriting written over several saves is one entry that grows", () => {
    const strokes = written("w", "x + 2 = 5", 100, 100, 30);
    const log = strokeByStroke(strokes);
    const half = log.findIndex((b) => b.length === written("w", "x + 2", 100, 100, 30).length);
    expect(logOf(log.slice(0, half + 1))).toEqual([`You wrote T1: "x + 2"`]);
    expect(logOf(log)).toEqual([`You wrote T1: "x + 2 = 5"`]);
  });

  it("typed text added, then typed into: one entry with the latest text", () => {
    const typed = (text: string) => [textBox("t", 100, 100, text)];
    expect(logOf([[], typed("x"), typed("x + 2"), typed("x + 2 = 5")])).toEqual([`You added a text box X1: "x + 2 = 5"`]);
  });

  it("a change to something else starts a new entry, and the earlier one stays as it was", () => {
    const a = (text: string) => textBox("a", 100, 100, text);
    const b = (text: string) => textBox("b", 100, 300, text);
    expect(logOf([[a("one")], [a("one"), b("two")], [a("one!"), b("two")]])).toEqual([
      `You added a text box X2: "two"`,
      `You changed X1 from "one" to "one!"`,
    ]);
  });

  it("edits of the same thing keep the first before and the latest after", () => {
    const typed = (text: string) => [textBox("t", 100, 100, text)];
    expect(logOf([typed("a"), typed("ab"), typed("abc")])).toEqual([`You changed X1 from "a" to "abc"`]);
    expect(logOf([typed("a"), typed("ab"), typed("a")])).toEqual(["You changed X1, then changed it back"]);
  });

  const edit = (e: Partial<CanvasEdit>): CanvasEdit => ({ actor: "user", action: "changed", label: "T1", kind: "writing", pen: true, ...e });

  it("only what carries on from the newest entry folds into it", () => {
    // Another label, an erase, a move after writing, or the other actor: each its own entry.
    expect(mergeEdit(edit({ label: "T1" }), edit({ label: "T2" }))).toBeNull();
    expect(mergeEdit(edit({ action: "added" }), edit({ action: "erased" }))).toBeNull();
    expect(mergeEdit(edit({ action: "added" }), edit({ action: "moved" }))).toBeNull();
    expect(mergeEdit(edit({}), edit({ actor: "ai" }))).toBeNull();
    expect(mergeEdit(edit({ action: "moved" }), edit({ action: "moved" }))?.action).toBe("moved");
  });

  it("writing that became part of a matrix: the matrix's entry replaces it, naming it only if it was told before", () => {
    const wrote = edit({ action: "added", label: "T2", after: { text: "1 1" } });
    const matrix = edit({ action: "added", label: "M1", kind: "matrix", after: { cells: [["1", "1"]], bars: [] }, took: ["T1", "T2"] });
    const merged = mergeEdit(wrote, matrix)!;
    expect(describeEdit(merged)).toBe("You added M1 (a 1×2 matrix); T1 is now part of it");
    expect(describeEdit(merged, "model")).toBe("The student added M1 (a 1×2 matrix); T1 is now part of it");
  });
});
