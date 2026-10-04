/**
 * The AI's changes as the canvas page applies them (lib/canvas/aiEdits.ts):
 * each goes on top of the board, a reply's changes are one undo step —
 * undone together with the canvas's own undo (lib/canvas/history.ts) — and
 * an edit the page has taken is never added again, even when it comes back
 * pending after the student erased it. And the ink they are drawn in.
 */
import { describe, expect, it } from "vitest";
import type { CanvasAnnotationElement, CanvasElement } from "@mola/shared";
import { applyAIElements, type AIEditState } from "../lib/canvas/aiEdits";
import { emptyHistory, pushHistory, undo } from "../lib/canvas/history";
import { aiInk, BACKGROUND_COLORS } from "../lib/canvas/styleConstants";
import { frame, textBox } from "../evals/canvas-reader/fixtures";

const annotation = (id: string, x: number, y: number): CanvasAnnotationElement => ({
  id, parentId: null, index: "a0", x, y, width: 20, height: 30, rotation: 0, opacity: 1, createdBy: "ai", type: "annotation",
  props: { kind: "error", mark: "circle", note: "Not this.", target: "T1 word 1", targetIds: ["w0"] },
});

const start = (elements: CanvasElement[]): AIEditState => ({ elements, history: emptyHistory(), step: null, taken: new Set() });
const ids = (elements: CanvasElement[]) => elements.map((e) => e.id);

describe("the AI's changes on the canvas page (applyAIElements)", () => {
  const work = [{ ...textBox("t1", 100, 100, "2 + 2 = 5"), index: "a5" }, frame("f1", 0, 0, 500, 500, "Sums")];

  it("puts an element on top of the board, in the frame that holds it", () => {
    const s = applyAIElements(start(work), "reply-1", [annotation("k1", 150, 100)]);
    expect(ids(s.elements)).toEqual(["t1", "f1", "k1"]);
    const k = s.elements.find((e) => e.id === "k1")!;
    expect(work.every((e) => e.index < k.index)).toBe(true);
    expect(k.parentId).toBe("f1");
    expect(s.fresh).toEqual(["k1"]);
  });

  it("makes a reply's changes one undo step, and so all that were pending when the page opened", () => {
    let s = applyAIElements(start(work), "reply-1", [annotation("k1", 150, 100)]);
    s = applyAIElements(s, "reply-1", [annotation("k2", 300, 100)]);
    expect(ids(s.elements)).toEqual(["t1", "f1", "k1", "k2"]);
    expect(s.history.past).toHaveLength(1);
    expect(undo(s.history, s.elements)!.value).toBe(work);

    const opened = applyAIElements(start(work), "pending", [annotation("k1", 150, 100), annotation("k2", 300, 100)]);
    expect(ids(opened.elements)).toEqual(["t1", "f1", "k1", "k2"]);
    expect(opened.elements[2]!.index < opened.elements[3]!.index).toBe(true);
    expect(opened.history.past).toHaveLength(1);
  });

  it("starts another step for the next reply, or after the student's own step", () => {
    let s = applyAIElements(start(work), "reply-1", [annotation("k1", 150, 100)]);
    s = applyAIElements(s, "reply-2", [annotation("k2", 300, 100)]);
    expect(s.history.past).toHaveLength(2);

    // A stroke drawn while reply 2 is still coming: its undo step, then reply 2's next change, a step of its own.
    const stroke = textBox("t2", 100, 300, "x");
    s = { ...s, history: pushHistory(s.history, s.elements), elements: [...s.elements, stroke] };
    s = applyAIElements(s, "reply-2", [annotation("k3", 400, 100)]);
    expect(s.history.past).toHaveLength(4);
    expect(ids(undo(s.history, s.elements)!.value)).toEqual(["t1", "f1", "k1", "k2", "t2"]);
  });

  it("never adds an edit twice: not one on the board, nor one the student took away before the save that acknowledges it", () => {
    const s = applyAIElements(start(work), "reply-1", [annotation("k1", 150, 100)]);
    const again = applyAIElements(s, "reply-1", [annotation("k1", 150, 100)]);
    expect(again.elements).toBe(s.elements);
    expect(again.fresh).toEqual([]);

    // Erased, then handed back by a sync as still pending: the page took it, so it stays erased.
    const erased = { ...s, elements: s.elements.filter((e) => e.id !== "k1") };
    const synced = applyAIElements(erased, "reply-1", [annotation("k1", 150, 100)]);
    expect(ids(synced.elements)).toEqual(["t1", "f1"]);
    expect(synced.history).toBe(erased.history);

    // One already on the board (another page added and saved it) is taken — to acknowledge — but not added.
    const there = applyAIElements(start([...work, annotation("k9", 150, 100)]), "pending", [annotation("k9", 150, 100)]);
    expect(ids(there.elements)).toEqual(["t1", "f1", "k9"]);
    expect(there.fresh).toEqual(["k9"]);
    expect(there.history.past).toHaveLength(0);
  });
});

describe("the AI's ink (aiInk)", () => {
  it("is Mola's accent on every light background, and its light tint on the dark one", () => {
    for (const bg of BACKGROUND_COLORS.slice(0, 3)) expect(aiInk(bg)).toEqual({ ink: "#481715", fg: "#f7f5ee" });
    expect(aiInk("#1c1b18")).toEqual({ ink: "#e3958b", fg: "#1c1b18" });
    expect(aiInk("not a color")).toEqual(aiInk("#ffffff"));
  });
});
