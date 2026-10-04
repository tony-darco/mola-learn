/**
 * Replies to the AI's annotations in the canvas chat: what the model reads
 * for one (lib/canvas/chatTurn.ts forModel) — the board, as with any
 * message, then which of its own annotations the student is answering —
 * the annotation as looked up on the board (repliedAnnotation), the tool
 * still there for the answer, and each annotation's thread as the canvas
 * page groups the chat (useCanvasChat.ts annotationThreads).
 *
 * The board is the annotate eval's, with "2 + 2 = 5" as T8.
 */
import { describe, expect, it } from "vitest";
import { annotate, ANNOTATE_TOOL, newAnnotateTurn } from "../lib/canvas/annotate";
import { replySection, type CanvasChatEvent, type CanvasContext } from "../lib/canvas/chat";
import { forModel, repliedAnnotation, runCanvasTurn } from "../lib/canvas/chatTurn";
import { ScriptedProvider } from "../lib/canvas/scripted";
import { readCanvas } from "../lib/canvas/textSyntax";
import { annotationThreads, type CanvasTurn } from "../components/chat/canvas/useCanvasChat";
import { makeBoard } from "../evals/canvas-annotate/fixtures";

const sample = makeBoard("clean");
const first = readCanvas(sample.elements);
const [k] = annotate(
  { annotations: [{ target: "T8 word 5", kind: "error", mark: "circle", note: "2 + 2 is 4, not 5." }] },
  { elements: sample.elements, doc: first.doc }, newAnnotateTurn(),
).placed;
const elements = [...sample.elements, k!];
const read = readCanvas(elements, { labels: first.labels });
const CHANGES = "WHAT CHANGED ON THE BOARD (in order)\nWhat was done to the board since the student's last message, oldest first, by the labels the board text below uses:\n- Mola marked T8 word 5 as an error (K1): \"2 + 2 is 4, not 5.\"";

describe("what the model reads for a reply to one of its annotations", () => {
  const replyTo = repliedAnnotation(elements, read.labels, k!.id);

  it("finds the annotation on the board by its id, with its label, kind, place and note", () => {
    expect(replyTo).toEqual({ label: "K1", kind: "error", target: "T8 word 5", note: "2 + 2 is 4, not 5." });
  });

  it("is the board as for any message, then the annotation it replies to, then what the student wrote", () => {
    const context: CanvasContext = { text: read.text, region: null, changes: CHANGES, replyTo: replyTo! };
    expect(read.text).toContain(`K1 — AI annotation: error, on T8 word 5 (circled). Note: "2 + 2 is 4, not 5."`);
    expect(forModel(context, "Why is it 4?")).toBe([
      CHANGES,
      read.text,
      `WHAT THE STUDENT IS REPLYING TO\nTheir message is a reply to your annotation K1, where you marked T8 word 5 as an error: "2 + 2 is 4, not 5."`,
      "THE STUDENT'S MESSAGE\nWhy is it 4?",
    ].join("\n\n"));
    // A message that isn't a reply reads as it always has.
    expect(forModel({ text: read.text, region: null }, "Is it right?")).toBe(`${read.text}\n\nTHE STUDENT'S MESSAGE\nIs it right?`);
  });

  it("names each kind of annotation the way the edit log does", () => {
    const of = (kind: "check" | "hint" | "note") => replySection({ label: "K2", kind, target: "M7", note: "Look." });
    expect(of("check")).toContain("a reply to your annotation K2, where you marked M7 as right: \"Look.\"");
    expect(of("hint")).toContain("where you left a hint on M7:");
    expect(of("note")).toContain("where you left a note on M7:");
  });

  it("has nothing to reply to when the annotation is gone, or the id is one of the student's own elements", () => {
    expect(repliedAnnotation(sample.elements, read.labels, k!.id)).toBeNull();
    expect(repliedAnnotation(elements, read.labels, sample.elements[0]!.id)).toBeNull();
  });

  it("keeps the tool for the answer, which may annotate again", async () => {
    const provider = new ScriptedProvider([
      [{ type: "tool_call", id: "c1", name: ANNOTATE_TOOL.name, input: { annotations: [{ target: "T8 word 3", kind: "hint", mark: "underline", note: "Start from here." }] } }, { type: "done", stopReason: "end_turn" }],
      [{ type: "text_delta", text: "Count on from the first 2." }, { type: "done", stopReason: "end_turn" }],
    ]);
    const events: CanvasChatEvent[] = [];
    const error = await runCanvasTurn({
      provider, system: "SYSTEM", maxTokens: 100,
      messages: [{ role: "user", content: forModel({ text: read.text, region: null, replyTo: replyTo! }, "Why is it 4?") }],
      board: () => ({ elements, doc: read.doc }), record: async () => {}, send: (ev) => events.push(ev),
    });
    expect(error).toBeNull();
    expect(provider.requests[0]!.tools).toEqual([ANNOTATE_TOOL]);
    expect(provider.requests[0]!.messages[0]!.content).toContain("a reply to your annotation K1, where you marked T8 word 5 as an error");
    expect(events.flatMap((e) => (e.type === "annotation" ? [e.element.props.target] : []))).toEqual(["T8 word 3"]);
  });
});

describe("an annotation's thread, as the page groups the chat", () => {
  const turn = (id: string, role: CanvasTurn["role"], annotationId: string | null = null): CanvasTurn => (
    { id, role, text: id, context: null, annotationId, streaming: false, error: null }
  );

  it("is each reply to it with the answer after it, oldest first — and nothing else in the chat", () => {
    const threads = annotationThreads([
      turn("check", "user"), turn("checked", "assistant"),
      turn("why", "user", "k1"), turn("because", "assistant"),
      turn("entry", "event"),
      turn("and this?", "user", "k2"), turn("entry 2", "event"), turn("this too", "assistant"),
      turn("thanks", "user"), turn("welcome", "assistant"),
      turn("one more", "user", "k1"), turn("answering…", "assistant"),
    ]);
    expect(Object.fromEntries([...threads].map(([id, ts]) => [id, ts.map((t) => t.id)]))).toEqual({
      k1: ["why", "because", "one more", "answering…"],
      k2: ["and this?", "this too"],
    });
  });
});
