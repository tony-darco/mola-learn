/**
 * A stand-in for the model in the canvas chat, so an e2e spec can run a
 * whole reply — tool calls, a tool error and its fix, the answer — the same
 * way every time. A chat whose model is "scripted:<name>" gets the named
 * script below instead of a model; only outside production, and only a
 * spec puts such a name on a chat (straight into the database).
 *
 * The unit tests drive runCanvasTurn with a ScriptedProvider of their own.
 */
import type { ProviderStreamEvent } from "@mola/shared";
import type { CompletionRequest, LLMProvider } from "@/lib/llm/types";

type ScriptEvents = (ProviderStreamEvent | { wait: number })[];
/**
 * What one model call streams, and where it pauses (`{ wait: ms }`) — a model thinking. Or made from the
 * request, for a call whose answer depends on what it was sent.
 */
export type ScriptStep = ScriptEvents | ((req: CompletionRequest) => ScriptEvents);

/** Streams `steps` in turn: a reply's first call gets the first, the call after a tool result the next, and so on. */
export class ScriptedProvider implements LLMProvider {
  readonly id = "scripted";
  /** Every request it was sent, in order. */
  readonly requests: CompletionRequest[] = [];
  constructor(private readonly steps: ScriptStep[]) {}

  async *stream(req: CompletionRequest): AsyncIterable<ProviderStreamEvent> {
    this.requests.push({ ...req, messages: [...req.messages] });
    // How many calls this reply has made: the assistant messages since the student's last one.
    let step = 0;
    for (let i = req.messages.length - 1; i >= 0 && req.messages[i]!.role !== "user"; i--) if (req.messages[i]!.role === "assistant") step++;
    const script = this.steps[step];
    for (const ev of (typeof script === "function" ? script(req) : script) ?? [{ type: "error", message: `the script has no step ${step + 1}` }]) {
      if ("wait" in ev) await new Promise((resolve) => setTimeout(resolve, ev.wait));
      else yield ev;
    }
  }
}

const annotateCall = (annotations: unknown[]): ProviderStreamEvent => ({ type: "tool_call", id: crypto.randomUUID(), name: "annotate_canvas", input: { annotations } });
const toolCall = (name: string, input: unknown): ProviderStreamEvent => ({ type: "tool_call", id: crypto.randomUUID(), name, input });
const done: ProviderStreamEvent = { type: "done", stopReason: "end_turn" };

const SCRIPTS: Record<string, ScriptStep[]> = {
  /**
   * For a board with the student's handwritten "2 + 2 =" (T1), a text box "teh answer" (X1), a text box "Start here" (X2)
   * and a rectangle (S1): the sum as math below T1 and the typo fixed; then the rectangle moved with an arrow
   * to a label that isn't on the board; then the arrow again, fixed (S1 is where the move left it); then the answer.
   */
  "write-sum": [
    [
      toolCall("write_on_canvas", {
        add: [{ kind: "math", content: "2 + 2 = 4", place: "below", near: "T1" }],
        change: [{ target: "X1", content: "the answer" }],
      }),
      done,
    ],
    [
      toolCall("arrange_canvas", { move: [{ target: "S1", place: "right", by: 150 }], arrows: [{ from: "X2", to: "S9" }] }),
      done,
    ],
    [toolCall("arrange_canvas", { arrows: [{ from: "X2", to: "S1" }] }), done],
    [{ type: "text_delta", text: "I wrote 2 + 2 = 4 below your line, fixed the typo in X1, moved S1 and drew an arrow to it from X2." }, done],
  ],
  /** The same board: four seconds' thought, time for the page to go; then the sum, the typo and the move, in one call to each tool; then the answer. */
  "write-sum-slowly": [
    [
      { wait: 4_000 },
      toolCall("write_on_canvas", { add: [{ kind: "math", content: "2 + 2 = 4", place: "below", near: "T1" }], change: [{ target: "X1", content: "the answer" }] }),
      toolCall("arrange_canvas", { move: [{ target: "S1", place: "right", by: 150 }] }),
      done,
    ],
    [{ type: "text_delta", text: "I wrote 2 + 2 = 4 below your line, fixed the typo in X1 and moved S1." }, done],
  ],
  /**
   * For a board whose one line of handwriting, T1, is "2 + 2 = 5": a check
   * under "2 + 2" and an error with a wrong label and kind sent as the mark,
   * then the error again, fixed, then the answer.
   */
  "check-sum": [
    [
      annotateCall([
        { target: "T1 words 1-3", kind: "check", mark: "underline", note: "Right: 2 + 2 is the sum to work out." },
        { target: "T2 word 5", kind: "error", mark: "check", note: "2 + 2 is 4, not 5." },
      ]),
      { type: "done", stopReason: "end_turn" },
    ],
    [
      annotateCall([{ target: "T1 word 5", kind: "error", mark: "circle", note: "2 + 2 is 4, not 5." }]),
      { type: "done", stopReason: "end_turn" },
    ],
    [
      { type: "text_delta", text: "Your sum is set up right, but 2 + 2 is 4, not 5 — I've circled the 5 on your board." },
      { type: "done", stopReason: "end_turn" },
    ],
  ],
  /** The same board: three seconds' thought, time for the page to go before the error on the 5 is placed; then the answer. */
  "check-sum-slowly": [
    [{ wait: 3_000 }, annotateCall([{ target: "T1 word 5", kind: "error", mark: "circle", note: "2 + 2 is 4, not 5." }]), { type: "done", stopReason: "end_turn" }],
    [{ type: "text_delta", text: "2 + 2 is 4, not 5 — I've circled the 5 on your board." }, { type: "done", stopReason: "end_turn" }],
  ],
  /**
   * The same board: a message gets the error on the 5, then the answer. A reply to one of its annotations gets,
   * after a second and a half's thought, an answer saying which annotation its request named, and what it said.
   */
  "check-sum-then-answer": [
    (req) => {
      const told = /a reply to your annotation (K\d+), where you (.+?): "/.exec(req.messages[req.messages.length - 1]!.content);
      return told
        ? [{ wait: 1_500 }, { type: "text_delta", text: `On ${told[1]}, where I ${told[2]}: count on 2 from 2 and you get 4.` }, { type: "done", stopReason: "end_turn" }]
        : [annotateCall([{ target: "T1 word 5", kind: "error", mark: "circle", note: "2 + 2 is 4, not 5." }]), { type: "done", stopReason: "end_turn" }];
    },
    [{ type: "text_delta", text: "2 + 2 is 4, not 5 — I've circled the 5 on your board." }, { type: "done", stopReason: "end_turn" }],
  ],
};

const SCRIPTED_MODEL_PREFIX = "scripted:";

/** The script a chat's model names, when it names one and this isn't production; otherwise null. */
export function scriptedProvider(model: string): LLMProvider | null {
  if (process.env.NODE_ENV === "production" || !model.startsWith(SCRIPTED_MODEL_PREFIX)) return null;
  const steps = SCRIPTS[model.slice(SCRIPTED_MODEL_PREFIX.length)];
  return steps ? new ScriptedProvider(steps) : null;
}
