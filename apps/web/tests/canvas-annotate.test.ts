/**
 * The canvas chat's write tool (lib/canvas/annotate.ts) and the reply that
 * runs it (lib/canvas/chatTurn.ts): what an annotate_canvas call places, and
 * what it sends back for the model to fix — an unknown label, kind and mark
 * swapped, an error on a whole matrix, more than a reply may place. Then
 * the annotations as the reader reads them back (lib/canvas/textSyntax) and
 * as the edit log tells them (lib/canvas/editLog.ts).
 *
 * The board is the annotate eval's: the 8-step reduction (M1–M8, row
 * operations T1–T7) with M8 row 1 col 4 written wrong, and "2 + 2 = 5" (T8).
 */
import { describe, expect, it } from "vitest";
import { canvasElementSchema, type CanvasAnnotationElement, type CanvasElement, type ProviderStreamEvent } from "@mola/shared";
import { annotate, ANNOTATE_TOOL, MAX_ANNOTATIONS_PER_TURN, newAnnotateTurn, type AnnotateBoard } from "../lib/canvas/annotate";
import type { CanvasChatEvent } from "../lib/canvas/chat";
import { MAX_MODEL_CALLS, runCanvasTurn } from "../lib/canvas/chatTurn";
import { describeCanvasChanges, describeEdit } from "../lib/canvas/editLog";
import { ScriptedProvider, type ScriptStep } from "../lib/canvas/scripted";
import { readCanvas } from "../lib/canvas/textSyntax";
import { makeBoard } from "../evals/canvas-annotate/fixtures";
import { textBox } from "../evals/canvas-reader/fixtures";

const sample = makeBoard("clean");
const [slip, sum] = sample.errors;
const read = readCanvas(sample.elements);
const board: AnnotateBoard = { elements: sample.elements, doc: read.doc };

const counter = () => {
  let n = 0;
  return () => `k${++n}`;
};
/** One call, in a reply of its own unless `turn` is given. */
const call = (annotations: unknown, turn = newAnnotateTurn()) => annotate({ annotations }, board, turn, counter());
const error = (target: string, note = "Not this.") => ({ target, kind: "error", mark: "circle", note });

describe("annotate_canvas: what it places", () => {
  it("places an annotation on a cell: an AI element on the cell's box, naming the place and what it was read from", () => {
    const { placed, result } = call([{ target: "M8 row 1 col 4", kind: "error", mark: "circle", note: "R1 − R2 gives 3 − 2 = 1 here." }]);
    expect(placed).toHaveLength(1);
    const [k] = placed;
    expect(canvasElementSchema.parse(k)).toEqual(k);
    expect(k).toMatchObject({
      id: "k1", type: "annotation", createdBy: "ai", parentId: null,
      x: slip!.box.minX, y: slip!.box.minY, width: slip!.box.maxX - slip!.box.minX, height: slip!.box.maxY - slip!.box.minY,
      props: { kind: "error", mark: "circle", note: "R1 − R2 gives 3 − 2 = 1 here.", target: "M8 row 1 col 4", targetIds: slip!.strokeIds },
    });
    // On top of everything already on the board.
    expect(sample.elements.every((e) => e.index < k!.index)).toBe(true);
    expect(result).toBe([
      "Placed 1 annotation on the board, for the student to see now:",
      "- error on M8 row 1 col 4, circled",
      "2 more annotations can be placed in this reply.",
    ].join("\n"));
  });

  it("takes the annotations as JSON text too, and says how to send them when there are none", () => {
    expect(annotate(JSON.stringify({ annotations: [error("T8 word 5")] }), board, newAnnotateTurn()).placed).toHaveLength(1);
    for (const input of [{}, { annotations: [] }, "not json", null]) {
      const r = annotate(input, board, newAnnotateTurn());
      expect(r.placed).toEqual([]);
      expect(r.result).toMatch(/^error: send the annotations as \{"annotations": \[/);
      expect(r.refused).toBe("shape");
    }
  });

  it("sends back an unknown label, saying what there is, and places the rest", () => {
    const { placed, result } = call([error("T8 word 5"), error("T9 word 5")]);
    expect(placed.map((e) => e.props.target)).toEqual(["T8 word 5"]);
    expect(result).toContain(`Not placed — fix these and send them again if they still matter:\n- annotation 2 ("T9 word 5"): no T9 on this canvas (its T labels are T1, T2, T3, T4, T5, T6, T7, T8)`);
    expect(call([error("M8 row 4 col 1")]).result).toContain(`- annotation 1 ("M8 row 4 col 1"): M8 has 3 rows`);
  });

  it("tells kind from mark when they are mixed up, and says what else is missing", () => {
    const { placed, result } = call([
      { target: "T8 word 5", kind: "error", mark: "check", note: "4, not 5." },
      { target: "T8 word 5", kind: "circle", mark: "circle", note: "4, not 5." },
      { kind: "error", mark: "circle" },
    ]);
    expect(placed).toEqual([]);
    expect(result).toContain(`- annotation 1 ("T8 word 5"): mark "check" is a kind, not a mark: kind is what the note says about the place (error, hint, check or note); mark is how the place is drawn round (circle, underline, box or none)`);
    expect(result).toContain(`- annotation 2 ("T8 word 5"): kind "circle" is a mark, not a kind`);
    expect(result).toContain("- annotation 3: the note is missing: say in a sentence what the student should see; the target is missing");
  });

  it("asks once for the entry when an error is on a whole matrix, line, row or column — sent again unchanged, it is placed", () => {
    const turn = newAnnotateTurn();
    const first = call([error("M8"), error("T8"), error("M8 col 4")], turn);
    expect(first.placed).toEqual([]);
    expect(first.settled).toBe(false);
    expect(first.result).toContain("Not placed yet — send these again now, pointed at the part that is wrong, or unchanged if all of it is:\n"
      + `- annotation 1 ("M8"): M8 is a whole matrix of 12 entries: point at the entry that is wrong, as "M8 row … col …" — or, if all of M8 is wrong, send this annotation again unchanged`);
    expect(first.result).toContain(`- annotation 2 ("T8"): T8 is a whole line of 5 words: point at the word or words that are wrong`);
    expect(first.result).toContain(`- annotation 3 ("M8 col 4"): M8 col 4 is 3 entries: point at the one that is wrong`);
    expect(call([error("M8")], turn).placed.map((e) => e.props.target)).toEqual(["M8"]);
  });

  it("places hints, checks and notes on a whole thing, and an error on one entry or word, straight away", () => {
    const { placed } = call([
      { target: "M8 row 1", kind: "hint", mark: "underline", note: "Look at this row again." },
      { target: "M7", kind: "check", mark: "box", note: "All right." },
      error("T8 words 3-5"),
    ]);
    expect(placed.map((e) => e.props.target)).toEqual(["M8 row 1", "M7", "T8 words 3–5"]);
  });

  it(`places at most ${MAX_ANNOTATIONS_PER_TURN} a reply: a call asking for more than are left places none of them`, () => {
    const turn = newAnnotateTurn();
    // The eval's shotgun: column 4 of every step.
    const shotgun = call(Array.from({ length: 8 }, (_, i) => error(`M${i + 1} row 1 col 4`)), turn);
    expect(shotgun.placed).toEqual([]);
    expect(shotgun.refused).toBe("cap");
    expect(shotgun.result).toBe("error: nothing was placed. A reply can place at most 3 annotations, and 3 are left, but this call asked for 8. "
      + "Keep one per separate mistake — in worked steps, only where it first goes wrong — and send only those.");

    expect(call([error("M8 row 1 col 4"), error("T8 word 5")], turn).placed).toHaveLength(2);
    expect(call([error("M8 row 2 col 4"), error("M8 row 3 col 4")], turn).result).toMatch(/and 1 is left, but this call asked for 2/);
    const last = call([error("M8 row 2 col 4")], turn);
    expect(last.placed).toHaveLength(1);
    expect(last.result).toMatch(/That is all the annotations this reply can place; say anything else in your reply\.$/);
    expect(call([error("M8 row 3 col 4")], turn).result).toMatch(/^error: nothing was placed\. .*this one has placed them all.*Say anything else in your reply\.$/);
    expect(turn.placed).toHaveLength(3);
  });

  it("doesn't place the same annotation twice in a reply, nor count it against what is left", () => {
    const turn = newAnnotateTurn();
    call([error("M8 row 1 col 4"), error("T8 word 5")], turn);
    // Sent again with one more, as a model fixing one of three would.
    const again = call([error("M8 row 1 col 4"), error("T8 word 5"), { ...error("M7 row 1 col 1"), kind: "check" }], turn);
    expect(again.placed.map((e) => e.props.target)).toEqual(["M7 row 1 col 1"]);
    expect(again.result).toContain("Already on the board from earlier in this reply, so not placed again:\n- error on M8 row 1 col 4, circled\n- error on T8 word 5, circled");
  });

  it("won't annotate an annotation", () => {
    const [k] = call([error("T8 word 5")]).placed;
    const withK = readCanvas([...sample.elements, k!], { labels: read.labels });
    const r = annotate({ annotations: [error("K1")] }, { elements: [...sample.elements, k!], doc: withK.doc }, newAnnotateTurn());
    expect(r.placed).toEqual([]);
    expect(r.result).toContain(`- annotation 1 ("K1"): K1 is one of your own annotations: point at the student's work`);
  });
});

// ── the reply ───────────────────────────────────────────────────────────────

const toolCall = (annotations: unknown[], name = ANNOTATE_TOOL.name): ProviderStreamEvent => ({ type: "tool_call", id: `call-${annotations.length}-${name}`, name, input: { annotations } });
const say = (text: string): ProviderStreamEvent => ({ type: "text_delta", text });
const end: ProviderStreamEvent = { type: "done", stopReason: "end_turn" };

async function reply(steps: ScriptStep[]) {
  const provider = new ScriptedProvider(steps);
  const events: CanvasChatEvent[] = [];
  /** What was recorded as pending, and what was sent, in order. */
  const order: string[] = [];
  let reads = 0;
  const error = await runCanvasTurn({
    provider, system: "SYSTEM", messages: [{ role: "user", content: "Check my work." }], maxTokens: 100,
    board: () => (reads++, board),
    record: async (placed) => { for (const e of placed) order.push(`recorded ${e.props.target}`); },
    send: (ev) => {
      events.push(ev);
      if (ev.type === "annotation") order.push(`sent ${ev.element.props.target}`);
    },
  });
  const text = events.flatMap((e) => (e.type === "text_delta" ? [e.text] : [])).join("");
  const annotations = events.flatMap((e) => (e.type === "annotation" ? [e.element] : []));
  return { error, events, text, annotations, requests: provider.requests, reads, order };
}

describe("a reply with the tool (runCanvasTurn)", () => {
  it("sends each annotation out as it is placed, and gives the model back what it has to fix", async () => {
    const r = await reply([
      [say("Two slips."), toolCall([error("M8 row 1 col 4", "3 − 2 = 1."), { ...error("T9 word 5"), mark: "check" }]), end],
      [say("And 2 + 2 is 4."), toolCall([error("T8 word 5", "4, not 5.")]), end],
      [say("Both are marked."), end],
      [say("Never asked for."), end],
    ]);
    expect(r.error).toBeNull();
    expect(r.events.map((e) => e.type)).toEqual(["text_delta", "annotation", "text_delta", "text_delta", "annotation", "text_delta", "text_delta"]);
    expect(r.annotations.map((e) => [e.props.target, e.props.note])).toEqual([["M8 row 1 col 4", "3 − 2 = 1."], ["T8 word 5", "4, not 5."]]);
    expect(r.text).toBe("Two slips.\n\nAnd 2 + 2 is 4.\n\nBoth are marked.");
    expect(r.reads).toBe(1);
    // Each kept as pending before it goes out, so one the page never gets isn't lost.
    expect(r.order).toEqual(["recorded M8 row 1 col 4", "sent M8 row 1 col 4", "recorded T8 word 5", "sent T8 word 5"]);

    // The second call saw its first call and what came of it — and that its words are on screen already.
    expect(r.requests.map((q) => q.tools?.length ?? 0)).toEqual([1, 1, 1]);
    const [, second] = r.requests;
    expect(second!.messages.slice(1, 3)).toEqual([
      { role: "assistant", content: "Two slips.", toolCalls: [expect.objectContaining({ name: "annotate_canvas" })] },
      { role: "tool", toolCallId: "call-2-annotate_canvas", content: expect.stringContaining(`- annotation 2 ("T9 word 5"): mark "check" is a kind, not a mark`) },
    ]);
    expect(second!.messages[2]!.content).toContain("; no T9 on this canvas (its T labels are T1,");
    expect(second!.messages[2]!.content).toMatch(/\nWhat you wrote before is already on the student's screen: carry on from it, without repeating it\.$/);
  });

  it("once all it asked for is on the board, keeps the tool while there is room, so a second, separate mistake gets its own mark", async () => {
    // A lead-in, then the call: the reply goes on after it, offered the tool for anything else.
    const spoke = await reply([[say("Look at T8:"), toolCall([error("T8 word 5")]), end], [say("2 + 2 is 4, not 5."), end], [say("Never asked for."), end]]);
    expect(spoke.requests.map((q) => q.tools?.length ?? 0)).toEqual([1, 1]);
    expect(spoke.text).toBe("Look at T8:\n\n2 + 2 is 4, not 5.");
    expect(spoke.requests[1]!.messages[2]!.content).toMatch(/\nAll of it is on the board\. If the board has another, separate mistake you haven't marked, mark it now; otherwise finish your reply to the student, in words\. What you wrote before is already on the student's screen/);

    // The matrix slip first, then the separate sum: both marked, then the answer.
    const both = await reply([[toolCall([error("M8 row 1 col 4", "3 − 2 = 1.")]), end], [toolCall([error("T8 word 5", "4, not 5.")]), end], [say("Two slips, both marked."), end]]);
    expect(both.requests.map((q) => q.tools?.length ?? 0)).toEqual([1, 1, 1]);
    expect(both.annotations.map((e) => e.props.target)).toEqual(["M8 row 1 col 4", "T8 word 5"]);
    expect(both.text).toBe("Two slips, both marked.");

    // Its whole answer written out again, word for word: none of it reaches the student.
    const answer = "You've done a great job with the row reduction, but 3 − 2 is 1, not 5.";
    const again = await reply([[say(answer), toolCall([error("M8 row 1 col 4")]), end], [say(`${answer} Fix that and you're done.`), end]]);
    expect(again.text).toBe(answer);
  });

  it("gives one last call without the tool once a call places nothing new, or the reply has no room left — a call written anyway is ignored", async () => {
    // The same mark sent again: nothing new, so the next call is for words only.
    const repeat = await reply([[toolCall([error("T8 word 5")]), end], [toolCall([error("T8 word 5")]), end], [toolCall([error("T8 word 4")]), say("2 + 2 is 4."), end]]);
    expect(repeat.requests.map((q) => q.tools?.length ?? 0)).toEqual([1, 1, 0]);
    expect(repeat.requests[2]!.messages[4]!.content).toMatch(/\nAll of it is on the board\. Now finish your reply to the student, in words\.$/);
    expect(repeat.annotations.map((e) => e.props.target)).toEqual(["T8 word 5"]);
    expect(repeat.text).toBe("2 + 2 is 4.");

    // All it can place, placed at once.
    const full = await reply([[toolCall([error("T8 word 5"), error("M8 row 1 col 4"), error("M8 row 1 col 3")]), end], [toolCall([error("T8 word 4")]), say("Three marks."), end]]);
    expect(full.requests.map((q) => q.tools?.length ?? 0)).toEqual([1, 0]);
    expect(full.annotations).toHaveLength(MAX_ANNOTATIONS_PER_TURN);
    expect(full.text).toBe("Three marks.");
  });

  it(`stops at ${MAX_MODEL_CALLS} calls, the last without the tool, so the reply ends in words`, async () => {
    const wrong = [toolCall([error("T9 word 5")]), end];
    const r = await reply([wrong, wrong, wrong, [say("T8 word 5 should be 4."), end]]);
    expect(r.requests.map((q) => q.tools?.length ?? 0)).toEqual([1, 1, 1, 0]);
    expect(r.annotations).toEqual([]);
    expect(r.text).toBe("T8 word 5 should be 4.");

    // An error on a whole matrix: asked once to narrow it down, then placed as sent.
    const whole = await reply([[toolCall([error("M8")]), end], [toolCall([error("M8")]), end], [say("All of M8 is off."), end]]);
    expect(whole.annotations.map((e) => e.props.target)).toEqual(["M8"]);
    expect(whole.text).toBe("All of M8 is off.");
  });

  it("answers a made-up tool with an error, and doesn't read the board for a reply that doesn't annotate", async () => {
    const made = await reply([[toolCall([], "erase_board"), end], [say("I can only annotate."), end]]);
    expect(made.requests[1]!.messages[2]).toMatchObject({ role: "tool", content: `error: there is no tool named "erase_board"; the one tool is annotate_canvas` });
    expect(made.reads).toBe(0);
    expect((await reply([[say("Looks fine."), end]])).reads).toBe(0);
  });

  it("fails with the provider's error, and when the model says nothing before running out of budget", async () => {
    expect((await reply([[{ type: "error", message: "ollama 500" }]])).error).toBe("ollama 500");
    expect((await reply([[{ type: "done", stopReason: "max_tokens" }]])).error).toMatch(/ran out of output budget/);
  });
});

// ── read back, and logged ───────────────────────────────────────────────────

/** The board with annotations `placed` on it, as the canvas page would save it. */
const annotated = (placed: CanvasAnnotationElement[], elements: CanvasElement[] = sample.elements) => [...elements, ...placed];

describe("the reader reads the AI's annotations back", () => {
  const [onSum, onM7] = call([
    { target: "T8 word 5", kind: "error", mark: "circle", note: "2 + 2 is 4, not 5." },
    { target: "M7", kind: "check", mark: "none", note: "This step is right." },
  ]).placed;

  it("as their own section, by K label, with kind, place, mark and note", () => {
    const { text } = readCanvas(annotated([onSum!, onM7!]), { labels: read.labels });
    expect(text).toContain("H a highlighter stroke, K an annotation the AI pinned to the board.");
    expect(text).toContain("- An AI annotation is a short note the AI assistant pinned to one place on the board");
    expect(text).toContain([
      "AI ANNOTATIONS\n2 AI annotations.",
      `K1 — AI annotation: check, on M7 (no mark). Note: "This step is right."`,
      `K2 — AI annotation: error, on T8 word 5 (circled). Note: "2 + 2 is 4, not 5."`,
    ].join("\n\n"));
  });

  it("and says when the place has changed since, or is gone", () => {
    // The 5 written over again (new strokes), and then erased.
    const rewritten = sample.elements.map((e) => (sum!.strokeIds.includes(e.id) ? { ...e, id: `again-${e.id}` } : e));
    expect(readCanvas(annotated([onSum!], rewritten), { labels: read.labels }).text)
      .toContain(`K1 — AI annotation: error, on T8 word 5, which has changed since (circled).`);
    const erased = sample.elements.filter((e) => !sum!.strokeIds.includes(e.id));
    expect(readCanvas(annotated([onSum!], erased), { labels: read.labels }).text)
      .toContain(`K1 — AI annotation: error, on T8 word 5, which is no longer on the board (circled).`);
  });

  it("leaves a board without annotations reading as it did", () => {
    expect(read.text).not.toMatch(/\bK an annotation|AI ANNOTATIONS|An AI annotation/);
  });
});

describe("the edit log tells the AI's annotations as its own", () => {
  const [k] = call([{ target: "T8 word 5", kind: "error", mark: "circle", note: "2 + 2 is 4, not 5." }]).placed;

  it("even in the same save as the student's own change", () => {
    const student = textBox("x1", 1330, 400, "Remember to check");
    const { edits } = describeCanvasChanges(sample.elements, [...sample.elements, student, k!], read.labels);
    expect(edits.map((e) => [e.actor, describeEdit(e)])).toEqual([
      ["user", `You added a text box X1: "Remember to check"`],
      ["ai", `Mola marked T8 word 5 as an error (K1): "2 + 2 is 4, not 5."`],
    ]);
    expect(describeEdit(edits[1]!, "model")).toBe(`Mola marked T8 word 5 as an error (K1): "2 + 2 is 4, not 5."`);
  });

  it("and the student taking one away as theirs", () => {
    const { edits } = describeCanvasChanges([...sample.elements, k!], sample.elements, read.labels);
    expect(edits.map((e) => [e.actor, describeEdit(e)])).toEqual([["user", `You deleted K1: "2 + 2 is 4, not 5."`]]);
  });
});
