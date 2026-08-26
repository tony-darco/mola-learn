/**
 * CONTRACT 4 (part 2) — the agent loop. FROZEN, working from Phase 0.
 *
 * Deliberately simple: a message array plus a read-think-act cycle (§4).
 * Everything else in the product is a layer bolted onto this.
 */
import { isArtifactToolResult, type StreamEvent } from "@mola/shared";
import type { LLMProvider, Message } from "../llm/types";
import type { ToolContext, ToolRegistry } from "./registry";

export type LoopOptions = {
  provider: LLMProvider;
  system: string;
  messages: Message[];
  tools: ToolRegistry;
  ctx: ToolContext;
  /** Guards against a model that loops on tool calls forever. */
  maxIterations?: number;
  /** Persists an artifact envelope and returns the stored record. */
  persistArtifact?: (result: unknown, ctx: ToolContext) => Promise<StreamEvent | null>;
};

/**
 * Runs read-think-act until the model stops calling tools, yielding client
 * stream events (contract 6) as it goes.
 */
export async function* runAgentLoop(opts: LoopOptions): AsyncGenerator<StreamEvent> {
  const { provider, system, tools, ctx } = opts;
  const maxIterations = opts.maxIterations ?? 8;
  const messages: Message[] = [...opts.messages];
  const specs = tools.specs();

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    let assistantText = "";
    const pendingCalls: { id: string; name: string; input: unknown }[] = [];
    let stopReason: "end_turn" | "tool_use" | "max_tokens" | "error" = "end_turn";

    for await (const ev of provider.stream({
      system,
      messages,
      tools: specs.length ? specs : undefined,
      signal: ctx.signal,
    })) {
      switch (ev.type) {
        case "text_delta":
          assistantText += ev.text;
          yield { type: "text_delta", text: ev.text };
          break;
        case "tool_call":
          pendingCalls.push({ id: ev.id, name: ev.name, input: ev.input });
          break;
        case "done":
          stopReason = ev.stopReason;
          break;
        case "error":
          yield { type: "error", message: ev.message };
          return;
      }
    }

    if (pendingCalls.length === 0) {
      yield { type: "message_end", messageId: ctx.chatId, stopReason };
      return;
    }

    messages.push({ role: "assistant", content: assistantText, toolCalls: pendingCalls });

    for (const call of pendingCalls) {
      yield {
        type: "tool_call_start",
        toolCallId: call.id,
        name: call.name,
        label: tools.labelFor(call.name, call.input),
      };

      try {
        const result = await tools.run(call.name, call.input, ctx);

        // An artifact result becomes a rendered block, not spliced-in text.
        if (isArtifactToolResult(result) && opts.persistArtifact) {
          const artifactEvent = await opts.persistArtifact(result, ctx);
          if (artifactEvent) yield artifactEvent;
        }

        const summary = summarize(result);
        yield { type: "tool_call_end", toolCallId: call.id, status: "ok", summary };
        messages.push({ role: "tool", content: summary, toolCallId: call.id });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        yield { type: "tool_call_end", toolCallId: call.id, status: "error", summary: message };
        // The error goes back to the model as an observation — it can recover.
        messages.push({ role: "tool", content: `error: ${message}`, toolCallId: call.id });
      }
    }
  }

  yield { type: "error", message: `agent loop exceeded ${maxIterations} iterations` };
}

function summarize(result: unknown): string {
  if (typeof result === "string") return result;
  if (isArtifactToolResult(result)) return `created ${result.kind}: ${result.title}`;
  return JSON.stringify(result);
}
