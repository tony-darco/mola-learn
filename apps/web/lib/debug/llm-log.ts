/**
 * Wraps an `LLMProvider` (contract 3) with the debug logger (agent-log.ts).
 * Applied once, at `getChatProvider`'s single choke point (lib/llm/index.ts,
 * not frozen) — since every sub-agent (flashcards/quizzes/mind-maps/retrieval,
 * all via the frozen subagent.ts) resolves its provider through that exact
 * same factory, wrapping there gets every LLM call in the system, top-level
 * and nested, for free.
 *
 * Gated on the ambient turn context (agent-log.ts's `currentTurn()`) rather
 * than a userId/email passed in here directly — the frozen subagent.ts calls
 * `getChatProvider(ctx.session.userId, {...})` with no email of its own, so
 * this is the only way nested calls learn who's asking without touching that
 * file. No ambient turn context (e.g. a caller that never went through
 * `beginTurn`) means no log line — same off-by-default posture as everywhere
 * else in this logger.
 */
import type { CompletionRequest, LLMProvider, Message } from "../llm/types";
import type { ProviderStreamEvent } from "@mola/shared";
import { currentTurn, isLoggingEnabledFor, logLlmCall } from "./agent-log";

export function withLlmCallLogging(provider: LLMProvider, model: string | undefined): LLMProvider {
  return {
    id: provider.id,
    async *stream(req: CompletionRequest): AsyncIterable<ProviderStreamEvent> {
      const turn = currentTurn();
      if (!turn || !isLoggingEnabledFor(turn.userEmail)) {
        yield* provider.stream(req);
        return;
      }

      const startedAt = Date.now();
      let text = "";
      const toolCalls: { id: string; name: string; input: unknown }[] = [];
      let stopReason: string | null = null;

      try {
        for await (const ev of provider.stream(req)) {
          if (ev.type === "text_delta") text += ev.text;
          else if (ev.type === "tool_call") toolCalls.push({ id: ev.id, name: ev.name, input: ev.input });
          else if (ev.type === "done") stopReason = ev.stopReason;
          else if (ev.type === "error") stopReason = `error: ${ev.message}`;
          yield ev;
        }
      } finally {
        const endedAt = Date.now();
        void logLlmCall(
          {
            turnId: turn.turnId,
            chatId: turn.chatId,
            userId: turn.userId,
            model: model ?? "unknown",
            system: req.system,
            messages: req.messages as Message[],
            responseText: text,
            toolCalls,
            stopReason,
            startedAt,
            endedAt,
          },
          turn.userEmail,
        );
      }
    },
  };
}
