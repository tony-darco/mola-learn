/**
 * The AI's changes as the canvas page applies them (lib/canvas/aiEdits.ts):
 * each streamed element goes on top of the board, and a reply's changes are
 * one undo step — undone together with the canvas's own undo
 * (lib/canvas/history.ts). And the ink they are drawn in.
 */
import { describe, expect, it } from "vitest";
import type { CanvasAnnotationElement, CanvasElement } from "@mola/shared";
import { applyAIElement, type AIStep } from "../lib/canvas/aiEdits";
import { emptyHistory, pushHistory, undo, type History } from "../lib/canvas/history";
import { aiInk, BACKGROUND_COLORS } from "../lib/canvas/styleConstants";
import { frame, textBox } from "../evals/canvas-reader/fixtures";

const annotation = (id: string, x: number, y: number): CanvasAnnotationElement => ({
  id, parentId: null, index: "a0", x, y, width: 20, height: 30, rotation: 0, opacity: 1, createdBy: "ai", type: "annotation",
  props: { kind: "error", mark: "circle", note: "Not this.", target: "T1 word 1", targetIds: ["w0"] },
});

type State = { elements: CanvasElement[]; history: History<CanvasElement[]>; step: AIStep | null };
const start = (elements: CanvasElement[]): State => ({ elements, history: emptyHistory(), step: null });
const ids = (s: { elements: CanvasElement[] }) => s.elements.map((e) => e.id);

describe("the AI's changes on the canvas page (applyAIElement)", () => {
  const work = [{ ...textBox("t1", 100, 100, "2 + 2 = 5"), index: "a5" }, frame("f1", 0, 0, 500, 500, "Sums")];

  it("puts an element on top of the board, in the frame that holds it", () => {
    const s = applyAIElement(start(work), "reply-1", annotation("k1", 150, 100));
    expect(ids(s)).toEqual(["t1", "f1", "k1"]);
    const k = s.elements.find((e) => e.id === "k1")!;
    expect(work.every((e) => e.index < k.index)).toBe(true);
    expect(k.parentId).toBe("f1");
  });

  it("makes a reply's changes one undo step", () => {
    let s = applyAIElement(start(work), "reply-1", annotation("k1", 150, 100));
    s = applyAIElement(s, "reply-1", annotation("k2", 300, 100));
    expect(ids(s)).toEqual(["t1", "f1", "k1", "k2"]);
    expect(s.history.past).toHaveLength(1);
    expect(undo(s.history, s.elements)!.value).toBe(work);
  });

  it("starts another step for the next reply, or after the student's own step", () => {
    let s = applyAIElement(start(work), "reply-1", annotation("k1", 150, 100));
    s = applyAIElement(s, "reply-2", annotation("k2", 300, 100));
    expect(s.history.past).toHaveLength(2);

    // A stroke drawn while reply 2 is still coming: its undo step, then reply 2's next change, a step of its own.
    const stroke = textBox("t2", 100, 300, "x");
    s = { ...s, history: pushHistory(s.history, s.elements), elements: [...s.elements, stroke] };
    s = applyAIElement(s, "reply-2", annotation("k3", 400, 100));
    expect(s.history.past).toHaveLength(4);
    expect(undo(s.history, s.elements)!.value.map((e) => e.id)).toEqual(["t1", "f1", "k1", "k2", "t2"]);
  });

  it("doesn't add an element that is already on the board", () => {
    const s = applyAIElement(start(work), "reply-1", annotation("k1", 150, 100));
    expect(applyAIElement(s, "reply-1", annotation("k1", 150, 100))).toBe(s);
  });
});

describe("the AI's ink (aiInk)", () => {
  it("is Mola's accent on every light background, and its light tint on the dark one", () => {
    for (const bg of BACKGROUND_COLORS.slice(0, 3)) expect(aiInk(bg)).toEqual({ ink: "#481715", fg: "#f7f5ee" });
    expect(aiInk("#1c1b18")).toEqual({ ink: "#e3958b", fg: "#1c1b18" });
    expect(aiInk("not a color")).toEqual(aiInk("#ffffff"));
  });
});
