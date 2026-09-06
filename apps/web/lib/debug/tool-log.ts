/**
 * Wraps a `Tool` (contract 4's registry, registry.ts — frozen) with the debug
 * logger (agent-log.ts). Must be applied at EVERY place a `Tool` gets
 * `.register()`ed, not just `buildRegistry()` (tools/index.ts): each of
 * flashcards.ts/quizzes.ts/mindmaps.ts's `create_*` tools spins its own
 * private, one-off `ToolRegistry` for its sub-agent (grep/bm25/vector_search
 * plus a private `emit_*` tool) that is never derived from `buildRegistry()`
 * — wrapping only there would silently miss most of the interesting activity
 * (the retrieval + "emit" tool calls a sub-agent actually makes). See each of
 * those files' own `.register()` calls for where this is applied a second
 * (or third) time on the same tool object.
 *
 * Deliberately wraps the plain `Tool` object rather than subclassing/wrapping
 * `ToolRegistry` itself — `ToolRegistry.subset()` builds a plain
 * `new ToolRegistry()` internally and would silently drop any such wrapper.
 */
import type { Tool, ToolContext } from "../agent/registry";
import { currentTurn, isLoggingEnabledFor, logToolCall } from "./agent-log";

export function withCallLogging<I>(tool: Tool<I>): Tool<I> {
  return {
    ...tool,
    async execute(input: I, ctx: ToolContext) {
      if (!isLoggingEnabledFor(ctx.session.email)) {
        return tool.execute(input, ctx);
      }

      const turnId = currentTurn()?.turnId ?? null;
      const startedAt = Date.now();
      try {
        const output = await tool.execute(input, ctx);
        void logToolCall(
          {
            turnId, chatId: ctx.chatId, userId: ctx.session.userId,
            toolName: tool.name, input, output, error: null,
            startedAt, endedAt: Date.now(),
          },
          ctx.session.email,
        );
        return output;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        void logToolCall(
          {
            turnId, chatId: ctx.chatId, userId: ctx.session.userId,
            toolName: tool.name, input, output: null, error: message,
            startedAt, endedAt: Date.now(),
          },
          ctx.session.email,
        );
        throw err;
      }
    },
  };
}
