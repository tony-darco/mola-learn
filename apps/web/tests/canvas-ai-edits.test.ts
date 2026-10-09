/**
 * The AI's changes as the canvas page applies them (lib/canvas/aiEdits.ts):
 * what it adds goes on top of the board, what it edits or moves changes
 * where it is, a reply's changes are one undo step — undone together with
 * the canvas's own undo (lib/canvas/history.ts) — and a change the page has
 * taken is never applied again, even when it comes back pending after the
 * student erased or undid it. And the ink they are drawn in.
 */
import { describe, expect, it } from "vitest";
import type { CanvasAnnotationElement, CanvasElement } from "@mola/shared";
import { applyAIChanges, applyChange, type AIEditState } from "../lib/canvas/aiEdits";
import { addedByAI, type AIChange } from "../lib/canvas/chat";
import { emptyHistory, pushHistory, redo, undo } from "../lib/canvas/history";
import { aiInk, BACKGROUND_COLORS } from "../lib/canvas/styleConstants";
import { frame, line, shape, textBox } from "../evals/canvas-reader/fixtures";

const annotation = (id: string, x: number, y: number): CanvasAnnotationElement => ({
  id, parentId: null, index: "a0", x, y, width: 20, height: 30, rotation: 0, opacity: 1, createdBy: "ai", type: "annotation",
  props: { kind: "error", mark: "circle", note: "Not this.", target: "T1 word 1", targetIds: ["w0"] },
});

const start = (elements: CanvasElement[]): AIEditState => ({ elements, history: emptyHistory(), step: null, taken: new Set() });
const ids = (elements: CanvasElement[]) => elements.map((e) => e.id);
/** Elements the AI added. */
const apply = (s: AIEditState, key: string, added: CanvasElement[]) => applyAIChanges(s, key, added.map(addedByAI));

describe("the AI's additions on the canvas page (applyAIChanges)", () => {
  const work = [{ ...textBox("t1", 100, 100, "2 + 2 = 5"), index: "a5" }, frame("f1", 0, 0, 500, 500, "Sums")];

  it("puts an element on top of the board, in the frame that holds it", () => {
    const s = apply(start(work), "reply-1", [annotation("k1", 150, 100)]);
    expect(ids(s.elements)).toEqual(["t1", "f1", "k1"]);
    const k = s.elements.find((e) => e.id === "k1")!;
    expect(work.every((e) => e.index < k.index)).toBe(true);
    expect(k.parentId).toBe("f1");
    expect(s.fresh).toEqual(["k1"]);
  });

  it("makes a reply's changes one undo step, and so all that were pending when the page opened", () => {
    let s = apply(start(work), "reply-1", [annotation("k1", 150, 100)]);
    s = apply(s, "reply-1", [annotation("k2", 300, 100)]);
    expect(ids(s.elements)).toEqual(["t1", "f1", "k1", "k2"]);
    expect(s.history.past).toHaveLength(1);
    expect(undo(s.history, s.elements)!.value).toBe(work);

    const opened = apply(start(work), "pending", [annotation("k1", 150, 100), annotation("k2", 300, 100)]);
    expect(ids(opened.elements)).toEqual(["t1", "f1", "k1", "k2"]);
    expect(opened.elements[2]!.index < opened.elements[3]!.index).toBe(true);
    expect(opened.history.past).toHaveLength(1);
  });

  it("starts another step for the next reply, or after the student's own step", () => {
    let s = apply(start(work), "reply-1", [annotation("k1", 150, 100)]);
    s = apply(s, "reply-2", [annotation("k2", 300, 100)]);
    expect(s.history.past).toHaveLength(2);

    // A stroke drawn while reply 2 is still coming: its undo step, then reply 2's next change, a step of its own.
    const stroke = textBox("t2", 100, 300, "x");
    s = { ...s, history: pushHistory(s.history, s.elements), elements: [...s.elements, stroke] };
    s = apply(s, "reply-2", [annotation("k3", 400, 100)]);
    expect(s.history.past).toHaveLength(4);
    expect(ids(undo(s.history, s.elements)!.value)).toEqual(["t1", "f1", "k1", "k2", "t2"]);
  });

  it("never adds an edit twice: not one on the board, nor one the student took away before the save that acknowledges it", () => {
    const s = apply(start(work), "reply-1", [annotation("k1", 150, 100)]);
    const again = apply(s, "reply-1", [annotation("k1", 150, 100)]);
    expect(again.elements).toBe(s.elements);
    expect(again.fresh).toEqual([]);

    // Erased, then handed back by a sync as still pending: the page took it, so it stays erased.
    const erased = { ...s, elements: s.elements.filter((e) => e.id !== "k1") };
    const synced = apply(erased, "reply-1", [annotation("k1", 150, 100)]);
    expect(ids(synced.elements)).toEqual(["t1", "f1"]);
    expect(synced.history).toBe(erased.history);

    // One already on the board (another page added and saved it) is taken — to acknowledge — but not added.
    const there = apply(start([...work, annotation("k9", 150, 100)]), "pending", [annotation("k9", 150, 100)]);
    expect(ids(there.elements)).toEqual(["t1", "f1", "k9"]);
    expect(there.fresh).toEqual(["k9"]);
    expect(there.history.past).toHaveLength(0);
  });
});

describe("the AI's edits and moves on the canvas page (applyAIChanges)", () => {
  const typo = { ...textBox("x1", 100, 100, "teh answer"), index: "a1" } as Extract<CanvasElement, { type: "text" }>;
  const box = { ...shape("s1", "rectangle", 400, 100, 80, 60), index: "a2" };
  const work = [typo, box];
  const fixed: AIChange = { id: "c1", before: typo, element: { ...typo, height: 40, props: { ...typo.props, text: "the answer" } } };
  const moved: AIChange = { id: "c2", before: box, element: { ...box, x: 600 } };

  it("changes an element where it is — only what the change changed, so the student's own changes since stay — and keeps it theirs", () => {
    const bolded = { ...typo, props: { ...typo.props, bold: true } };
    const s = applyAIChanges(start([bolded, box]), "reply-1", [fixed]);
    expect(s.elements[0]).toEqual({ ...bolded, height: 40, props: { ...bolded.props, text: "the answer" } });
    expect(s.elements[0]!.createdBy).toBe("user");
    expect(s.elements[1]).toBe(box);
    expect(s.fresh).toEqual(["c1"]);
  });

  it("makes a reply's additions, edits and moves one undo step, and redo brings them all back", () => {
    const arrow = { ...line("a1", { x: 200, y: 110 }, { x: 390, y: 120 }, "end"), createdBy: "ai" as const };
    let s = applyAIChanges(start(work), "reply-1", [fixed]);
    s = applyAIChanges(s, "reply-1", [moved, addedByAI(arrow)]);
    expect(s.history.past).toHaveLength(1);
    const after = s.elements;
    expect(after.map((e) => [e.id, e.x, e.type === "text" ? e.props.text : null])).toEqual([["x1", 100, "the answer"], ["s1", 600, null], ["a1", 200, null]]);
    const undone = undo(s.history, s.elements)!;
    expect(undone.value).toBe(work);
    expect(redo(undone.history, undone.value)!.value).toBe(after);
  });

  it("never applies a change twice, and takes one whose element is gone without doing anything", () => {
    const s = applyAIChanges(start(work), "reply-1", [moved]);
    const again = applyAIChanges(s, "reply-1", [moved]);
    expect(again.elements).toBe(s.elements);
    expect(again.fresh).toEqual([]);

    // Undone by the student, then handed back by a sync as still pending: it stays undone.
    const undone = undo(s.history, s.elements)!;
    expect(applyAIChanges({ ...s, history: undone.history, elements: undone.value }, "reply-1", [moved]).elements).toBe(work);

    // The shape erased before the move came: taken — to acknowledge — but nothing to move, and no undo step.
    const erased = applyAIChanges(start([typo]), "pending", [moved]);
    expect(erased.elements).toEqual([typo]);
    expect(erased.fresh).toEqual(["c2"]);
    expect(erased.history.past).toHaveLength(0);
  });

  it("keeps what each change needs to be taken back on its own: the same change, the other way", () => {
    const changed = applyChange(typo, fixed.before!, fixed.element);
    expect(applyChange(changed, fixed.element, fixed.before!)).toEqual(typo);
    expect(applyChange(applyChange(box, box, moved.element), moved.element, box)).toEqual(box);
  });
});

describe("the AI's ink (aiInk)", () => {
  it("is Mola's accent on every light background, and its light tint on the dark one", () => {
    for (const bg of BACKGROUND_COLORS.slice(0, 3)) expect(aiInk(bg)).toEqual({ ink: "#481715", fg: "#f7f5ee" });
    expect(aiInk("#1c1b18")).toEqual({ ink: "#e3958b", fg: "#1c1b18" });
    expect(aiInk("not a color")).toEqual(aiInk("#ffffff"));
  });
});
