/**
 * The canvas chat's other write tools (lib/canvas/writes.ts) and the reply
 * that runs them beside annotate_canvas (lib/canvas/chatTurn.ts): what
 * write_on_canvas and arrange_canvas do — text and math put into free space
 * beside a label, typed text and math changed with the element as it was
 * kept, arrows drawn between labels and pointed elsewhere, shapes and arrows
 * moved — and what they send back for the model to fix. Then what they did
 * as the reader reads it back, and as the edit log tells it.
 *
 * The board: a handwritten "2 + 2 =" (T1), text boxes "teh answer" (X1) and
 * "Start here" (X2), a sticky note (N1), math (Q1), a rectangle (S1), an
 * arrow from X1 to S1 (A2) and one drawn with the pen (A1).
 */
import { describe, expect, it } from "vitest";
import { canvasElementSchema, type CanvasElement, type CanvasLineElement, type ProviderStreamEvent } from "@mola/shared";
import { ANNOTATE_TOOL, type AnnotateBoard } from "../lib/canvas/annotate";
import type { AIChange, CanvasChatEvent } from "../lib/canvas/chat";
import { runCanvasTurn } from "../lib/canvas/chatTurn";
import { aiCandidates, creditAI, describeCanvasChanges, describeEdit } from "../lib/canvas/editLog";
import { ScriptedProvider, type ScriptStep } from "../lib/canvas/scripted";
import { AI_ACCENT } from "../lib/canvas/styleConstants";
import { readCanvas } from "../lib/canvas/textSyntax";
import {
  arrange, ARRANGE_TOOL, arrowBetween, MAX_CHANGES_PER_TURN, newWriteTurn, placeBeside, write, WRITE_TOOL, type WriteTurn,
} from "../lib/canvas/writes";
import { drawn, line, math, note, shape, textBox, written } from "../evals/canvas-reader/fixtures";
import { arrowStrokes } from "../e2e/support/strokeFont";

const elements: CanvasElement[] = [
  ...written("w", "2 + 2 =", 100, 100, 40),
  textBox("x1", 100, 400, "teh answer"),
  textBox("x2", 600, 100, "Start here"),
  shape("s1", "rectangle", 600, 400, 100, 60),
  line("a1", { x: 326, y: 412 }, { x: 594, y: 430 }, "end"),
  note("n1", 900, 100, "Remember the sign"),
  math("q1", 900, 400, "x^2"),
  ...arrowStrokes({ x: 100, y: 700 }, { x: 300, y: 700 }, "joined").map((s, i) => drawn(`p${i}`, s)),
];
const read = readCanvas(elements);
const board: AnnotateBoard = { elements, doc: read.doc };
const byId = (id: string, els: CanvasElement[] = elements) => els.find((e) => e.id === id)!;
const boxOf = (label: string) => read.doc.items.find((i) => i.label === label)!.box;

const counter = () => {
  let n = 0;
  return () => `k${++n}`;
};
/** One call of a tool, in a reply of its own unless `turn` is given. */
const writeCall = (input: unknown, turn: WriteTurn = newWriteTurn()) => write(input, board, turn, counter());
const arrangeCall = (input: unknown, turn: WriteTurn = newWriteTurn()) => arrange(input, board, turn, counter());
const one = (changes: AIChange[]) => {
  expect(changes).toHaveLength(1);
  return changes[0]!;
};
/** The board with `changes` applied, as the canvas page would save it. */
const applied = (changes: AIChange[], els: CanvasElement[] = elements) => changes.reduce(
  (acc, c) => (acc.some((e) => e.id === c.element.id) ? acc.map((e) => (e.id === c.element.id ? c.element : e)) : [...acc, c.element]), els,
);

describe("the board", () => {
  it("reads as the tests below expect", () => {
    expect(read.doc.items.map((i) => [i.label, i.kind, i.pen])).toEqual([
      ["T1", "writing", true], ["X1", "text", false], ["X2", "text", false], ["N1", "note", false], ["Q1", "math", false],
      ["A1", "arrow", true], ["A2", "arrow", false], ["S1", "shape", false],
    ]);
    expect(read.doc.items.find((i) => i.label === "A2")!.ends).toEqual(["X1", "S1"]);
  });
});

describe("write_on_canvas: new text and math", () => {
  it("writes math below a handwritten line: an AI element in Mola's accent, in the free space under it, about as big as the writing", () => {
    const { changes, result, settled } = writeCall({ add: [{ kind: "math", content: "2 + 2 = 4", place: "below", near: "T1" }] });
    const c = one(changes);
    expect(c.before).toBeNull();
    expect(c.id).toBe(c.element.id);
    expect(canvasElementSchema.parse(c.element)).toEqual(c.element);
    const t1 = boxOf("T1");
    expect(c.element).toMatchObject({ type: "math", createdBy: "ai", parentId: null, x: t1.minX, y: t1.maxY + 16, props: { latex: "2 + 2 = 4", color: AI_ACCENT } });
    expect(c.element.type === "math" && c.element.props.fontSize).toBe(48);
    expect(elements.every((e) => e.index < c.element.index)).toBe(true);
    expect(settled).toBe(true);
    expect(result).toBe(["Done, for the student to see now:", `- wrote math "2 + 2 = 4" below T1`, "5 more changes can be made in this reply."].join("\n"));
  });

  it("writes a text box beside typed text at its font size, big enough for what it says, and takes math in $…$", () => {
    const { changes } = writeCall({ add: [
      { kind: "text", content: "Check the sign\nin step 2", place: "left", near: "X2" },
      { kind: "math", content: "$x^2 + 1$", place: "above", near: "Q1" },
    ] });
    const [text, formula] = changes;
    const x2 = boxOf("X2");
    expect(text!.element).toMatchObject({ type: "text", createdBy: "ai", props: { text: "Check the sign\nin step 2", fontSize: 16, color: AI_ACCENT, autoFit: "grow" } });
    // Middle to middle, and room for both lines at the text box's line height.
    expect(text!.element.x + text!.element.width).toBe(x2.minX - 16);
    expect(Math.abs(text!.element.y + text!.element.height / 2 - (x2.minY + x2.maxY) / 2)).toBeLessThanOrEqual(1);
    expect(text!.element.height).toBeGreaterThanOrEqual(2 * 1.45 * 16);
    expect(text!.element.width).toBeGreaterThanOrEqual("Check the sign".length * 0.6 * 16);
    expect(formula!.element).toMatchObject({ type: "math", props: { latex: "x^2 + 1", fontSize: 16 } });
    expect(formula!.element.y + formula!.element.height).toBe(boxOf("Q1").minY - 16);
  });

  it("keeps clear of everything already there — going further that way until it is — and says when nothing within reach is free", () => {
    const anchor = { minX: 0, minY: 0, maxX: 100, maxY: 20 };
    const below = { minX: 0, minY: 40, maxX: 200, maxY: 80 };
    expect(placeBeside(anchor, { width: 50, height: 20 }, "below", [{ box: anchor }, { box: below }])).toEqual({ minX: 0, minY: 100, maxX: 50, maxY: 120 });
    // A slanted arrow's box is mostly empty: only the arrow itself is in the way.
    const slant = { box: { minX: 0, minY: 30, maxX: 400, maxY: 300 }, ends: [{ x: 400, y: 30 }, { x: 0, y: 300 }] as [{ x: number; y: number }, { x: number; y: number }] };
    expect(placeBeside(anchor, { width: 50, height: 20 }, "below", [{ box: anchor }, slant])).toEqual({ minX: 0, minY: 36, maxX: 50, maxY: 56 });
    expect(placeBeside(anchor, { width: 50, height: 20 }, "below", [{ box: { minX: -100, minY: 30, maxX: 300, maxY: 1000 } }])).toBeNull();

    const walled = [...elements, shape("wall", "rectangle", 0, 430, 600, 700)];
    const r = write({ add: [{ kind: "text", content: "the answer", place: "below", near: "X1" }] }, { elements: walled, doc: readCanvas(walled, { labels: read.labels }).doc }, newWriteTurn());
    expect(r.changes).toEqual([]);
    expect(r.settled).toBe(false);
    expect(r.result).toContain(`- add 1 ("X1"): there's no free space within 480 canvas units below X1: write it on another side of it, or beside something else`);
  });

  it("keeps what one call writes clear of what the call before it wrote", () => {
    const turn = newWriteTurn();
    const first = one(writeCall({ add: [{ kind: "text", content: "first", place: "below", near: "X1" }] }, turn).changes).element;
    const second = one(writeCall({ add: [{ kind: "text", content: "second", place: "below", near: "X1" }] }, turn).changes).element;
    expect(second.y).toBeGreaterThanOrEqual(first.y + first.height + 16);
  });
});

describe("write_on_canvas: changing typed text and math", () => {
  it("changes a text box or math — the student's too — keeping it theirs, and the whole element as it was", () => {
    const { changes, result } = writeCall({ change: [{ target: "X1", content: "the answer" }, { target: "Q1", content: "$x^3$" }] });
    const [text, formula] = changes;
    const x1 = byId("x1") as Extract<CanvasElement, { type: "text" }>;
    // One line of 16-pixel text, as tall as the text tool makes it (the fixture's box is a little less).
    expect(text).toEqual({ id: "k1", before: x1, element: { ...x1, height: 32, props: { ...x1.props, text: "the answer" } } });
    expect(formula!.before).toBe(byId("q1"));
    expect(formula!.element).toMatchObject({ id: "q1", createdBy: "user", props: { latex: "x^3" } });
    expect(result).toBe([
      "Done, for the student to see now:", `- changed X1 to "the answer"`, `- changed Q1 to "x^3"`, "4 more changes can be made in this reply.",
    ].join("\n"));
  });

  it("grows a text box to hold what it says now, and changes a sticky note's text", () => {
    const long = "The answer is four, since two and two make four.";
    const [text, sticky] = writeCall({ change: [{ target: "X1", content: long }, { target: "N1", content: "Remember the minus sign" }] }).changes;
    expect(text!.element.width).toBe(byId("x1").width);
    expect(text!.element.height).toBeGreaterThan(byId("x1").height);
    expect(sticky!.element).toMatchObject({ type: "note", props: { text: "Remember the minus sign" } });
  });

  it("changes the same thing twice in a reply as one change after another, each keeping what it changed from", () => {
    const turn = newWriteTurn();
    const first = one(writeCall({ change: [{ target: "X1", content: "the anser" }] }, turn).changes);
    const second = one(writeCall({ change: [{ target: "X1", content: "the answer" }] }, turn).changes);
    expect(second.before).toEqual(first.element);
    expect(writeCall({ change: [{ target: "X1", content: "the answer" }] }, turn).result).toContain("Already done earlier in this reply");
  });
});

describe("write_on_canvas: what it sends back to fix", () => {
  it("won't change handwriting, or anything but typed text and math, nor leave it empty; and says what is wrong with each", () => {
    const { changes, result, settled } = writeCall({
      change: [
        { target: "T1", content: "2 + 2 = 4" }, { target: "S1", content: "a box" }, { target: "X1", content: "   " },
        { target: "X9", content: "x" }, { target: "X1 word 2", content: "x" },
      ],
      add: [{ kind: "image", content: "x", place: "under", near: "T1" }, { kind: "math", content: "\\frac{1}{", place: "below", near: "T1" }],
    });
    expect(changes).toEqual([]);
    expect(settled).toBe(false);
    expect(result).toContain([
      "Nothing was done.",
      "Not done — fix these and send them again if they still matter:",
      `- change 1 ("T1"): T1 is handwriting, which can't be changed: annotate it, or write the correction beside it with "add"`,
      `- change 2 ("S1"): S1 is a shape: only text boxes (X), sticky notes (N) and math (Q) can be changed`,
      `- change 3 ("X1"): a change can't leave X1 empty: send all of its new text`,
      `- change 4 ("X9"): no X9 on this canvas (its X labels are X1, X2)`,
      `- change 5 ("X1 word 2"): X1 is not handwriting, so it has no rows, columns or words: target all of it, as "X1"`,
      `- add 1 ("T1"): kind must be text or math; place must be one of below, above, right, left`,
    ].join("\n"));
    expect(result).toMatch(/- add 2 \("T1"\): the LaTeX doesn't parse \(KaTeX parse error: .*\): send it fixed/);
  });

  it("says when a change changes nothing, and how to send the call when it isn't in the tool's shape", () => {
    expect(writeCall({ change: [{ target: "X1", content: "teh answer" }] }).result).toContain(`- change 1 ("X1"): X1 already says exactly that, so nothing changed`);
    for (const input of [{}, { add: [] }, "not json", null]) {
      const r = writeCall(input);
      expect(r.refused).toBe("shape");
      expect(r.result).toMatch(/^error: send \{"add": \[/);
    }
    // One item sent on its own, or the call as JSON text, is taken.
    expect(writeCall({ add: { kind: "text", content: "hi", place: "left", near: "X2" } }).changes).toHaveLength(1);
    expect(writeCall(JSON.stringify({ change: [{ target: "X2", content: "Start" }] })).changes).toHaveLength(1);
  });

  it(`makes at most ${MAX_CHANGES_PER_TURN} changes a reply, across both tools: a call asking for more than are left does none of them`, () => {
    const turn = newWriteTurn();
    const add = (n: number) => ({ add: Array.from({ length: n }, (_, i) => ({ kind: "text", content: `note ${i}`, place: "right", near: "N1" })) });
    const tooMany = writeCall(add(7), turn);
    expect(tooMany.refused).toBe("cap");
    expect(tooMany.result).toBe("error: nothing was done. A reply can make at most 6 changes with write_on_canvas and arrange_canvas, and 6 are left, but this call asked for 7. "
      + "Send only the ones that matter most.");
    expect(writeCall(add(4), turn).changes).toHaveLength(4);
    expect(arrangeCall({ move: [{ target: "S1", place: "right", by: 10 }, { target: "S1", place: "right", by: 20 }, { target: "A2", place: "below", by: 5 }] }, turn).result)
      .toMatch(/and 2 are left, but this call asked for 3/);
    const last = arrangeCall({ move: [{ target: "S1", place: "right", by: 10 }, { target: "S1", place: "below", by: 20 }] }, turn);
    expect(last.changes).toHaveLength(2);
    expect(last.result).toMatch(/That is all the changes this reply can make; say anything else in your reply\.$/);
    expect(writeCall({ add: [{ kind: "text", content: "one more", place: "left", near: "X2" }] }, turn).result)
      .toMatch(/^error: nothing was done\. .*this one has made them all.*Say anything else in your reply\.$/);
  });
});

describe("arrange_canvas: arrows", () => {
  it("draws an arrow from one label to another, its ends just outside them — read back as joining them, made by the AI", () => {
    const { changes, result } = arrangeCall({ arrows: [{ from: "X2", to: "S1" }] });
    const c = one(changes);
    expect(c.before).toBeNull();
    expect(canvasElementSchema.parse(c.element)).toEqual(c.element);
    expect(c.element).toMatchObject({ type: "line", createdBy: "ai", props: { color: AI_ACCENT, startArrow: false, endArrow: true, dash: "solid" } });
    expect(result).toContain("- drew an arrow from X2 to S1");

    const again = readCanvas(applied(changes), { labels: read.labels });
    const arrow = again.doc.items.find((i) => i.elementIds[0] === c.element.id)!;
    expect(arrow).toMatchObject({ label: "A3", kind: "arrow", ends: ["X2", "S1"], madeByAI: true });
    expect(again.text).toMatch(/A3 — arrow \(made by the AI\) from X2 to S1\./);
  });

  it("ends an arrow where the line between the two centres leaves one box and comes to the other", () => {
    expect(arrowBetween({ minX: 0, minY: 0, maxX: 100, maxY: 20 }, { minX: 300, minY: 0, maxX: 400, maxY: 20 })).toEqual([{ x: 106, y: 10 }, { x: 294, y: 10 }]);
    expect(arrowBetween({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, { minX: 50, minY: 50, maxX: 200, maxY: 200 })).toBeNull();
  });

  it("points an arrow somewhere else — a new head, a new tail — keeping its other end, and the arrow as it was", () => {
    const head = one(arrangeCall({ point: [{ arrow: "A2", to: "X2" }] }).changes);
    const was = byId("a1") as CanvasLineElement;
    expect(head.before).toBe(was);
    expect(head.element).toMatchObject({ id: "a1", createdBy: "user", x: was.x, y: was.y });
    expect(readCanvas(applied([head]), { labels: read.labels }).doc.items.find((i) => i.label === "A2")!.ends).toEqual(["X1", "X2"]);

    const tail = one(arrangeCall({ point: [{ arrow: "A2", from: "T1" }] }).changes).element as CanvasLineElement;
    expect([tail.x + tail.props.endX, tail.y + tail.props.endY]).toEqual([was.x + was.props.endX, was.y + was.props.endY]);
    expect(readCanvas(applied([{ id: "c", before: was, element: tail }]), { labels: read.labels }).doc.items.find((i) => i.label === "A2")!.ends).toEqual(["T1", "S1"]);
  });
});

describe("arrange_canvas: moves", () => {
  it("moves a shape by a distance, or beside a label into free space, keeping it where it was too", () => {
    const by = one(arrangeCall({ move: [{ target: "S1", place: "right", by: 200 }] }).changes);
    expect(by).toEqual({ id: "k1", before: byId("s1"), element: { ...byId("s1"), x: 800 } });
    const beside = one(arrangeCall({ move: [{ target: "S1", place: "below", near: "X1" }] }).changes);
    const x1 = boxOf("X1");
    expect(beside.element).toMatchObject({ x: x1.minX, y: x1.maxY + 16, width: 100, height: 60 });
  });

  it("moves a whole arrow, both ends together", () => {
    const moved = one(arrangeCall({ move: [{ target: "A2", place: "above", by: 50 }] }).changes);
    const was = byId("a1") as CanvasLineElement;
    expect(moved.element).toEqual({ ...was, y: was.y - 50 });
  });

  it("builds on what the reply changed already: an arrow goes to where a shape is now, and a second move starts where the first left it", () => {
    const turn = newWriteTurn();
    const first = one(arrangeCall({ move: [{ target: "S1", place: "right", by: 200 }] }, turn).changes);
    const arrow = one(arrangeCall({ arrows: [{ from: "X2", to: "S1" }] }, turn).changes).element as CanvasLineElement;
    expect(arrow.y + arrow.props.endY).toBeGreaterThanOrEqual(400 - 6);
    expect(arrow.x + arrow.props.endX).toBeGreaterThanOrEqual(800 - 6);
    const second = one(arrangeCall({ move: [{ target: "S1", place: "below", by: 100 }] }, turn).changes);
    expect(second.before).toEqual(first.element);
    expect(second.element).toMatchObject({ x: 800, y: 500 });
  });

  it("moves no handwriting, nothing drawn with the pen, and only shapes, arrows and lines; and says what is wrong with each", () => {
    const { changes, result } = arrangeCall({
      move: [
        { target: "T1", place: "right", by: 10 }, { target: "A1", place: "right", by: 10 }, { target: "X1", place: "right", by: 10 },
        { target: "S1", place: "right", by: 10, near: "X1" }, { target: "S1", place: "right" }, { target: "S1", place: "right", by: -5 },
        { target: "S1", place: "below", near: "S1" }, { target: "S1", place: "sideways", by: 10 },
      ],
      point: [{ arrow: "S1", to: "X1" }, { arrow: "A2" }, { arrow: "A2", to: "A2" }],
      arrows: [{ from: "X1", to: "X1" }, { from: "X1", to: "Z1" }],
    });
    expect(changes).toEqual([]);
    expect(result).toContain([
      `- move 1 ("T1"): T1 is handwriting, which can't be moved`,
      `- move 2 ("A1"): A1 is drawn with the pen, which can't be moved`,
      `- move 3 ("X1"): X1 is a text box: only shapes (S), arrows (A) and lines (L) can be moved`,
      `- move 4 ("S1"): give near or by, not both`,
      `- move 5 ("S1"): say where to move S1: beside something (near), or how far (by)`,
      `- move 6 ("S1"): by must be how far to move it, in canvas units: more than 0 and at most 2000`,
      `- move 7 ("S1"): S1 can't be moved beside itself`,
      `- move 8 ("S1"): place must be one of below, above, right, left`,
      `- point 1 ("S1"): S1 is a shape: only arrows (A) and lines (L) can be pointed somewhere else`,
      `- point 2 ("A2"): say where A2 should point: a new head (to), a new tail (from), or both`,
      `- point 3 ("A2"): A2 can't point at itself`,
      `- arrow 1 ("X1" to "X1"): an arrow needs two different ends, but both are X1`,
      `- arrow 2 ("X1" to "Z1"): no Z1 on this canvas`,
    ].join("\n"));
  });

  it("points nothing at one of its own annotations, and says how to send the call when it isn't in the tool's shape", async () => {
    const { annotate, newAnnotateTurn } = await import("../lib/canvas/annotate");
    const [k] = annotate({ annotations: [{ target: "T1 word 4", kind: "error", mark: "circle", note: "Finish it." }] }, board, newAnnotateTurn()).placed;
    const withK = [...elements, k!];
    const r = arrange({ arrows: [{ from: "X1", to: "K1" }] }, { elements: withK, doc: readCanvas(withK, { labels: read.labels }).doc }, newWriteTurn());
    expect(r.result).toContain(`- arrow 1 ("X1" to "K1"): K1 is one of your own annotations: name the student's work it is on`);
    for (const input of [{}, { move: [] }, "[]"]) expect(arrangeCall(input).refused).toBe("shape");
  });
});

// ── the reply ───────────────────────────────────────────────────────────────

const toolCall = (name: string, input: unknown, id = name): ProviderStreamEvent => ({ type: "tool_call", id, name, input });
const say = (text: string): ProviderStreamEvent => ({ type: "text_delta", text });
const end: ProviderStreamEvent = { type: "done", stopReason: "end_turn" };

async function reply(steps: ScriptStep[]) {
  const provider = new ScriptedProvider(steps);
  const events: CanvasChatEvent[] = [];
  /** What was recorded as pending, and what was sent, in order. */
  const order: string[] = [];
  const error = await runCanvasTurn({
    provider, system: "SYSTEM", messages: [{ role: "user", content: "Write it out for me." }], maxTokens: 100,
    board: () => board,
    record: async (changes) => { for (const c of changes) order.push(`recorded ${c.element.type}`); },
    send: (ev) => {
      events.push(ev);
      if (ev.type === "annotation") order.push("sent annotation");
      if (ev.type === "change") order.push(`sent ${ev.change.element.type}`);
    },
  });
  const changes = events.flatMap((e) => (e.type === "change" ? [e.change] : []));
  const text = events.flatMap((e) => (e.type === "text_delta" ? [e.text] : [])).join("");
  return { error, events, changes, text, requests: provider.requests, order };
}

const math24 = { add: [{ kind: "math", content: "2 + 2 = 4", place: "below", near: "T1" }] };

describe("a reply with several tools (runCanvasTurn)", () => {
  it("offers all three, runs each call to its own tool, and sends each change out once it is kept as pending", async () => {
    const r = await reply([
      [say("Here it is."), toolCall(WRITE_TOOL.name, math24), toolCall(ANNOTATE_TOOL.name, { annotations: [{ target: "T1 word 4", kind: "hint", mark: "none", note: "Then 4." }] }), end],
      [toolCall(ARRANGE_TOOL.name, { arrows: [{ from: "X2", to: "S9" }] }), end],
      [toolCall(ARRANGE_TOOL.name, { arrows: [{ from: "X2", to: "S1" }] }), end],
      [say("I wrote the sum below your line and drew an arrow."), end],
    ]);
    expect(r.error).toBeNull();
    expect(r.requests[0]!.tools!.map((t) => t.name)).toEqual(["annotate_canvas", "write_on_canvas", "arrange_canvas"]);
    expect(r.requests.map((q) => (q.tools ? 1 : 0))).toEqual([1, 1, 1, 0]);
    expect(r.order).toEqual(["recorded math", "sent math", "recorded annotation", "sent annotation", "recorded line", "sent line"]);
    expect(r.changes.map((c) => c.element.type)).toEqual(["math", "line"]);
    expect(r.text).toBe("Here it is.\n\nI wrote the sum below your line and drew an arrow.");

    // Each tool's result went back to its call; done with room to spare, the model is asked for the rest of what was asked.
    const [, second, third, fourth] = r.requests;
    expect(second!.messages.slice(2, 4)).toEqual([
      { role: "tool", toolCallId: "write_on_canvas", content: expect.stringContaining(`- wrote math "2 + 2 = 4" below T1`) },
      { role: "tool", toolCallId: "annotate_canvas", content: expect.stringMatching(/^Placed 1 annotation[\s\S]*\nAll of it is on the board\. If the student asked for more on the board that you haven't done yet, do it now; otherwise finish your reply to the student, in words\. What you wrote before/) },
    ]);
    expect(third!.messages[5]!.content).toContain(`- arrow 1 ("X2" to "S9"): no S9 on this canvas (its S labels are S1)`);
    expect(fourth!.messages[7]!.content).toMatch(/- drew an arrow from X2 to S1\n4 more changes can be made in this reply\.\nAll of it is on the board\. If the student asked for more/);
  });

  it("gives one last call in words once a call does nothing new, or the reply can make no more changes", async () => {
    const repeat = await reply([[toolCall(WRITE_TOOL.name, math24), end], [toolCall(WRITE_TOOL.name, math24), end], [say("Done."), end]]);
    expect(repeat.requests.map((q) => (q.tools ? 1 : 0))).toEqual([1, 1, 0]);
    expect(repeat.changes).toHaveLength(1);
    expect(repeat.requests[2]!.messages[4]!.content).toMatch(/Already done earlier in this reply[\s\S]*\nAll of it is on the board\. Now finish your reply to the student, in words\.$/);

    const six = { add: Array.from({ length: MAX_CHANGES_PER_TURN }, (_, i) => ({ kind: "text", content: `step ${i}`, place: "above", near: "X2" })) };
    const full = await reply([[toolCall(WRITE_TOOL.name, six), end], [say("Six steps."), end]]);
    expect(full.requests.map((q) => (q.tools ? 1 : 0))).toEqual([1, 0]);
    expect(full.changes).toHaveLength(MAX_CHANGES_PER_TURN);
  });

  it("names all its tools when the model calls one it doesn't have", async () => {
    const r = await reply([[toolCall("erase_board", {}), end], [say("I can't erase."), end]]);
    expect(r.requests[1]!.messages[2]).toMatchObject({ role: "tool", content: `error: there is no tool named "erase_board"; the tools are annotate_canvas, write_on_canvas, arrange_canvas` });
  });
});

// ── read back, and logged ───────────────────────────────────────────────────

describe("what the tools did, read back and logged", () => {
  const turn = newWriteTurn();
  const makeId = counter();
  const wrote = write({ add: [{ kind: "math", content: "2 + 2 = 4", place: "below", near: "T1" }, { kind: "text", content: "Nearly!", place: "left", near: "X2" }] }, board, turn, makeId).changes;
  const drew = arrange({ arrows: [{ from: "X2", to: "S1" }] }, board, turn, makeId).changes;
  const edited = write({ change: [{ target: "X1", content: "the answer" }, { target: "Q1", content: "x^3" }] }, board, newWriteTurn(), makeId).changes;
  const moved = arrange({ move: [{ target: "S1", place: "right", by: 200 }], point: [{ arrow: "A2", to: "X2" }] }, board, newWriteTurn(), makeId).changes;

  it("reads what the AI made as made by the AI, and what it changed of the student's as still theirs", () => {
    const { text } = readCanvas(applied([...wrote, ...drew, ...edited]), { labels: read.labels });
    expect(text).toMatch(/Q2 — math \(made by the AI\) at top-left \(\d+, \d+\), LaTeX: "2 \+ 2 = 4"/);
    expect(text).toMatch(/X3 — text box \(made by the AI\) at top-left \(\d+, \d+\): "Nearly!"/);
    expect(text).toMatch(/A3 — arrow \(made by the AI\) from X2 to S1\./);
    expect(text).toContain(`X1 — text box at top-left (100, 400): "the answer"`);
    expect(text).toContain(`Q1 — math at top-left (900, 400), LaTeX: "x^3"`);
    const after = readCanvas(applied(moved), { labels: read.labels }).text;
    expect(after).toMatch(/A2 — arrow from X1 to X2\./);
    expect(after).toMatch(/S1 — rectangle around nothing\. Top-left \(800, 400\)/);
  });

  it("logs what it added as Mola's", () => {
    const { edits } = describeCanvasChanges(elements, applied([...wrote, ...drew]), read.labels);
    expect(edits.map((e) => [e.actor, describeEdit(e)])).toEqual([
      ["ai", `Mola wrote math Q2: "2 + 2 = 4"`],
      ["ai", `Mola wrote a text box X3: "Nearly!"`],
      ["ai", "Mola drew an arrow A3 from X2 to S1"],
    ]);
  });

  it("logs what it changed and moved of what was there as Mola's — while it stands as Mola left it", () => {
    const after = applied([...edited, ...moved]);
    const left = [...edited, ...moved].map((c) => c.element);
    const { edits, snapshot } = describeCanvasChanges(elements, after, read.labels);
    expect(edits.map((e) => describeEdit(e))).toEqual([
      `You changed X1 from "teh answer" to "the answer"`, `You changed Q1 from "x^2" to "x^3"`, "You changed A2, now from X1 to X2", "You moved S1",
    ]);
    expect(aiCandidates(edits, snapshot).sort()).toEqual(["a1", "q1", "s1", "x1"]);
    expect(creditAI(edits, snapshot, left).map((e) => [e.actor, describeEdit(e)])).toEqual([
      ["ai", `Mola changed X1 from "teh answer" to "the answer"`],
      ["ai", `Mola changed Q1 from "x^2" to "x^3"`],
      ["ai", "Mola changed A2, now from X1 to X2"],
      ["ai", "Mola moved S1"],
    ]);
    expect(describeEdit(creditAI(edits, snapshot, left)[3]!, "model")).toBe("Mola moved S1");

    // X1 typed over by the student in the same save; Q1 measured to its new size by the page, as math is once drawn.
    const since = after.map((e) => (e.id === "x1" && e.type === "text" ? { ...e, props: { ...e.props, text: "the answer!" } } : e.id === "q1" ? { ...e, width: 60 } : e));
    const again = describeCanvasChanges(elements, since, read.labels);
    expect(creditAI(again.edits, again.snapshot, left).map((e) => [e.actor, e.label])).toEqual([["user", "X1"], ["ai", "Q1"], ["ai", "A2"], ["ai", "S1"]]);
  });
});
