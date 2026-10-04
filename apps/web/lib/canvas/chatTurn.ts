/**
 * One reply in the canvas chat (app/api/canvas/[canvasId]/chat/route.ts),
 * run against the model with its one tool, annotate_canvas (annotate.ts).
 *
 * The model's text goes out as it streams. When it calls the tool, the
 * annotations it placed are recorded as pending, then go out as events —
 * the canvas page puts each on the board as it arrives, and saves it;
 * nothing here writes to the canvas, and one no page took is added by the
 * next that opens (chatServer.ts) — and the tool's result goes back to the
 * model: what was placed, and what to fix — a label that isn't on the
 * board, an error on a whole matrix, ….
 *
 * Once all it asked for is on the board, the model gets one last call,
 * without the tool, to finish its reply: it often writes only a lead-in
 * before the call ("Let's look at M2:"), and the eval saw replies end
 * there. Offered the tool again instead, gemma4:26b sent the same
 * annotation over and over. At most MAX_MODEL_CALLS calls; the last offers
 * no tool, so a reply ends in words.
 */
import type { CanvasAnnotationElement } from "@mola/shared";
import type { LLMProvider, Message } from "@/lib/llm/types";
import { annotate, ANNOTATE_TOOL, MAX_ANNOTATIONS_PER_TURN, newAnnotateTurn, type AnnotateBoard } from "./annotate";
import type { CanvasChatEvent, CanvasContext } from "./chat";

/** The canvas chat's system prompt — here rather than in the route, so the annotate eval sends exactly what ships. */
export const CANVAS_CHAT_SYSTEM = [
  "You are Mola, a tutor looking at a student's whiteboard. You can't see the board itself: "
    + "each of the student's messages comes with the board converted to text — all of it, or only the part they selected.",
  "Refer to things on the board by their labels (M1, Q2, T3, …), and to parts of handwriting by place (\"M1 row 2 col 3\"), as the text explains. "
    + "If something you need is unreadable or missing from the text, say so rather than guessing.",
  "You can also mark the board with the annotate_canvas tool: each annotation pins a short note to one place on the board, beside the student's work. "
    + "When the student asks you to check their work, mark the mistakes you find with it, beside telling them; use it too when pointing at a spot makes "
    + "your answer clearer — but not for every reply.",
  "Point each annotation at the smallest place that holds what you mean: the one matrix entry (\"M2 row 1 col 3\") or word (\"T3 word 5\") that is wrong, "
    + `not the whole matrix or line. At most ${MAX_ANNOTATIONS_PER_TURN} annotations per reply, so mark what matters most — in worked steps, the first mistake, `
    + "since every step after it carries it — and say the rest in your reply.",
  "You can't change or erase anything on the board, your own annotations included. Your earlier annotations are in the board text, labelled K: "
    + "don't mark the same thing again.",
].join("\n\n");

/**
 * The model's whole output for one call, thinking included. On a clean board
 * read, thinking is short and helps a little; on a garbled one it runs away,
 * fills the provider's default 8192 tokens, and only then does OllamaProvider
 * silently retry with thinking off. Capping it here makes that fallback come
 * after about 40 s instead of about 2 minutes. The cap also bounds the
 * visible answer (the retry gets the same budget), which is plenty for a
 * question about the board.
 */
export const MAX_OUTPUT_TOKENS = 3072;

/** What the model reads for one of the student's messages: what changed on the board since their last one, the board as text, then what they wrote. */
export function forModel(context: CanvasContext | null, message: string): string {
  return context
    ? [...(context.changes ? [context.changes] : []), context.text, `THE STUDENT'S MESSAGE\n${message}`].join("\n\n")
    : message;
}

/**
 * Four: annotating, sending again what wasn't placed (a label fixed, an
 * entry instead of the whole matrix), and the answer, with one call to
 * spare. Each call sends the whole board again, so more costs real time.
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
  /** Keeps what was placed until a page has put it on the board (chatServer.ts recordAIEdits) — done before it is sent. */
  record: (placed: CanvasAnnotationElement[]) => Promise<void>;
  send: (event: CanvasChatEvent) => void;
}): Promise<string | null> {
  const { provider, system, maxTokens, send } = opts;
  const messages = [...opts.messages];
  const turn = newAnnotateTurn();
  let board: AnnotateBoard | null = null;
  /** Everything the student has been shown so far. */
  let shownSoFar = "";
  let answerOnly = false;

  for (let call = 1; call <= MAX_MODEL_CALLS; call++) {
    const offer = !answerOnly && call < MAX_MODEL_CALLS;
    const said = shownSoFar !== "";
    let text = "";
    let stopReason = "end_turn";
    const calls: { id: string; name: string; input: unknown }[] = [];
    let started = false;
    const show = (t: string) => {
      // What the model says after a tool call starts a paragraph of its own.
      if (!started && said) send({ type: "text_delta", text: "\n\n" });
      started = true;
      shownSoFar += t;
      send({ type: "text_delta", text: t });
    };
    // A call after words were shown: its first words are held until they show it isn't starting the answer over.
    let held: string | null = said ? "" : null;
    let repeat = false;
    for await (const ev of provider.stream({ system, messages, maxTokens, tools: offer ? [ANNOTATE_TOOL] : undefined })) {
      if (ev.type === "text_delta") {
        text += ev.text;
        if (repeat) continue;
        if (held === null) show(ev.text);
        else if ((held += ev.text).length >= HOLD) {
          repeat = notForTheStudent(held, shownSoFar);
          if (!repeat) show(held);
          held = null;
        }
      }
      if (ev.type === "tool_call") calls.push({ id: ev.id, name: ev.name, input: ev.input });
      if (ev.type === "done") stopReason = ev.stopReason;
      if (ev.type === "error") return ev.message;
    }
    if (held && !notForTheStudent(held, shownSoFar)) show(held);
    const saidNow = shownSoFar !== "";

    // A call written out when no tool was offered is not acted on.
    if (calls.length === 0 || !offer) {
      // Same guard as the agent loop: a thinking model can spend its whole budget before saying anything.
      return !saidNow && stopReason === "max_tokens" ? "The model ran out of output budget before producing a visible answer. Try again." : null;
    }

    messages.push({ role: "assistant", content: text, toolCalls: calls });
    let settled = true;
    const results: Message[] = [];
    for (const c of calls) {
      if (c.name !== ANNOTATE_TOOL.name) {
        settled = false;
        results.push({ role: "tool", content: `error: there is no tool named "${c.name}"; the one tool is ${ANNOTATE_TOOL.name}`, toolCallId: c.id });
        continue;
      }
      const done = annotate(c.input, (board ??= opts.board()), turn);
      await opts.record(done.placed);
      for (const element of done.placed) send({ type: "annotation", element });
      settled &&= done.settled;
      results.push({ role: "tool", content: done.result, toolCallId: c.id });
    }
    // What it wrote is on the student's screen already: the next call should carry on from it, not write it out again.
    const shown = saidNow ? " What you wrote before is already on the student's screen: carry on from it, without repeating it." : "";
    if (settled) {
      answerOnly = true;
      results[results.length - 1]!.content += `\nAll of it is on the board. Now finish your reply to the student, in words.${shown}`;
    } else if (saidNow) results[results.length - 1]!.content += `\n${shown.trim()}`;
    messages.push(...results);
  }
  return null;
}

/**
 * How much of a later call's text is held back: told its words are on
 * screen already, gemma4:26b still wrote its whole answer out again in 2
 * of 9 eval replies, word for word from the start.
 */
const HOLD = 40;
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
/**
 * A later call's first words, held: the start of what was already shown,
 * over again — or its thinking, leaked into the reply under its channel's
 * name, which gemma4:26b's last call gave instead of words now and then
 * ("thought\n<channel|>", "thought\n探"). The provider's to filter, really
 * (lib/llm/ollama.ts); here only once the reply has said something.
 */
const notForTheStudent = (held: string, shown: string) =>
  squash(shown).startsWith(squash(held).slice(0, HOLD)) || /^\s*thought\s*(?:\n|<)/.test(held);
