/**
 * One reply in the canvas chat (app/api/canvas/[canvasId]/chat/route.ts),
 * run against the model with its one tool, annotate_canvas (annotate.ts).
 *
 * The model's text goes out as it streams. When it calls the tool, the
 * annotations it placed go out as events — the canvas page puts each on the
 * board as it arrives, and saves it; nothing here writes to the canvas —
 * and the tool's result goes back to the model, which carries on: sending
 * again what wasn't placed, or answering. At most MAX_MODEL_CALLS calls, and
 * the last offers no tool, so a reply always ends in words.
 */
import type { LLMProvider, Message } from "@/lib/llm/types";
import { annotate, ANNOTATE_TOOL, newAnnotateTurn, type AnnotateBoard } from "./annotate";
import type { CanvasChatEvent } from "./chat";

/**
 * Four: annotating, sending again what wasn't placed (a label fixed, an
 * entry instead of the whole matrix), and the answer, with one call to
 * spare. Each call reads the whole board again, so more costs real time.
 */
export const MAX_MODEL_CALLS = 4;

/** Runs the reply, sending its events as they come; resolves to its error, or null. */
export async function runCanvasTurn(opts: {
  provider: LLMProvider;
  system: string;
  messages: Message[];
  maxTokens: number;
  /** The whole board as the model was shown it — read only if the model annotates. */
  board: () => AnnotateBoard;
  send: (event: CanvasChatEvent) => void;
}): Promise<string | null> {
  const { provider, system, maxTokens, send } = opts;
  const messages = [...opts.messages];
  const turn = newAnnotateTurn();
  let board: AnnotateBoard | null = null;
  let said = false;

  for (let call = 1; call <= MAX_MODEL_CALLS; call++) {
    let text = "";
    let stopReason = "end_turn";
    const calls: { id: string; name: string; input: unknown }[] = [];
    for await (const ev of provider.stream({ system, messages, maxTokens, tools: call < MAX_MODEL_CALLS ? [ANNOTATE_TOOL] : undefined })) {
      if (ev.type === "text_delta") {
        // What the model says after a tool call starts a paragraph of its own.
        if (!text && said) send({ type: "text_delta", text: "\n\n" });
        text += ev.text;
        said = true;
        send(ev);
      }
      if (ev.type === "tool_call") calls.push({ id: ev.id, name: ev.name, input: ev.input });
      if (ev.type === "done") stopReason = ev.stopReason;
      if (ev.type === "error") return ev.message;
    }

    if (calls.length === 0) {
      // Same guard as the agent loop: a thinking model can spend its whole budget before saying anything.
      return !said && stopReason === "max_tokens" ? "The model ran out of output budget before producing a visible answer. Try again." : null;
    }

    messages.push({ role: "assistant", content: text, toolCalls: calls });
    for (const c of calls) {
      let result: string;
      if (c.name === ANNOTATE_TOOL.name) {
        const done = annotate(c.input, (board ??= opts.board()), turn);
        for (const element of done.placed) send({ type: "annotation", element });
        result = done.result;
      } else {
        result = `error: there is no tool named "${c.name}"; the one tool is ${ANNOTATE_TOOL.name}`;
      }
      messages.push({ role: "tool", content: result, toolCallId: c.id });
    }
  }
  return null;
}
