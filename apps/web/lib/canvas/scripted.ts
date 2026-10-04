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

/** What one model call streams, and where it pauses (`{ wait: ms }`) — a model thinking. */
export type ScriptStep = (ProviderStreamEvent | { wait: number })[];

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
    for (const ev of this.steps[step] ?? [{ type: "error", message: `the script has no step ${step + 1}` }]) {
      if ("wait" in ev) await new Promise((resolve) => setTimeout(resolve, ev.wait));
      else yield ev;
    }
  }
}

const annotateCall = (annotations: unknown[]): ProviderStreamEvent => ({ type: "tool_call", id: crypto.randomUUID(), name: "annotate_canvas", input: { annotations } });

const SCRIPTS: Record<string, ScriptStep[]> = {
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
};

const SCRIPTED_MODEL_PREFIX = "scripted:";

/** The script a chat's model names, when it names one and this isn't production; otherwise null. */
export function scriptedProvider(model: string): LLMProvider | null {
  if (process.env.NODE_ENV === "production" || !model.startsWith(SCRIPTED_MODEL_PREFIX)) return null;
  const steps = SCRIPTS[model.slice(SCRIPTED_MODEL_PREFIX.length)];
  return steps ? new ScriptedProvider(steps) : null;
}
