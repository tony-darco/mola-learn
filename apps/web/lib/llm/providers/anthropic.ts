/**
 * BYOK provider — Anthropic. Same contract-3 shape as OpenAIProvider: chat
 * completions only, no `embed`, plain `fetch`.
 *
 * Anthropic's Messages API has a different wire shape than the OpenAI-style
 * one Ollama and OpenAI share: `system` is a top-level field (already true of
 * our own `CompletionRequest`), tool calls stream as `input_json_delta`
 * fragments against a `content_block` index, and a "tool" role message
 * becomes a `tool_result` content block on a `user` message.
 */
import type { ProviderStreamEvent } from "@mola/shared";
import type { CompletionRequest, LLMProvider, Message } from "../types";

const DEFAULT_MODEL = "claude-3-5-haiku-latest";
const API_VERSION = "2023-06-01";

type BlockState = { kind: "text" } | { kind: "tool_use"; id: string; name: string; json: string };

export class AnthropicProvider implements LLMProvider {
  readonly id = "anthropic";
  constructor(
    private readonly apiKey: string,
    private readonly model: string = DEFAULT_MODEL,
  ) {}

  async *stream(req: CompletionRequest): AsyncIterable<ProviderStreamEvent> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": API_VERSION,
      },
      signal: req.signal,
      body: JSON.stringify({
        model: this.model,
        system: req.system,
        messages: toAnthropicMessages(req.messages),
        max_tokens: req.maxTokens ?? 2048,
        temperature: req.temperature ?? 0.7,
        stream: true,
        ...(req.tools?.length
          ? { tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) }
          : {}),
      }),
    });

    if (!res.ok || !res.body) {
      yield { type: "error", message: `anthropic ${res.status}: ${await res.text()}` };
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const blocks = new Map<number, BlockState>();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line; each frame has an "event:"
      // line and a "data:" line.
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
        if (!dataLine) continue;
        let event: AnthropicEvent;
        try {
          event = JSON.parse(dataLine.slice(6));
        } catch {
          continue;
        }

        if (event.type === "content_block_start" && event.content_block && event.index !== undefined) {
          blocks.set(
            event.index,
            event.content_block.type === "tool_use"
              ? { kind: "tool_use", id: event.content_block.id!, name: event.content_block.name!, json: "" }
              : { kind: "text" },
          );
        } else if (event.type === "content_block_delta" && event.index !== undefined) {
          const block = blocks.get(event.index);
          if (event.delta?.type === "text_delta" && event.delta.text) {
            yield { type: "text_delta", text: event.delta.text };
          } else if (event.delta?.type === "input_json_delta" && block?.kind === "tool_use") {
            block.json += event.delta.partial_json ?? "";
          }
        } else if (event.type === "content_block_stop" && event.index !== undefined) {
          const block = blocks.get(event.index);
          if (block?.kind === "tool_use") {
            yield { type: "tool_call", id: block.id, name: block.name, input: safeParse(block.json) };
          }
          blocks.delete(event.index);
        } else if (event.type === "message_delta" && event.delta?.stop_reason) {
          yield { type: "done", stopReason: mapStopReason(event.delta.stop_reason) };
        } else if (event.type === "error") {
          yield { type: "error", message: event.error?.message ?? "anthropic stream error" };
        }
      }
    }
  }
}

type AnthropicEvent = {
  type: string;
  index?: number;
  content_block?: { type: string; id?: string; name?: string };
  delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string };
  error?: { message?: string };
};

function mapStopReason(reason: string): "end_turn" | "tool_use" | "max_tokens" | "error" {
  if (reason === "tool_use") return "tool_use";
  if (reason === "max_tokens") return "max_tokens";
  if (reason === "end_turn" || reason === "stop_sequence") return "end_turn";
  return "error";
}

/**
 * Anthropic has no system-role or tool-role message — collapse ours into
 * user/assistant turns with the appropriate content blocks.
 */
function toAnthropicMessages(messages: Message[]) {
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      if (m.role === "tool") {
        return {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }],
        };
      }
      if (m.toolCalls?.length) {
        return {
          role: "assistant",
          content: [
            ...(m.content ? [{ type: "text", text: m.content }] : []),
            ...m.toolCalls.map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: c.input })),
          ],
        };
      }
      return { role: m.role, content: m.content };
    });
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json || "{}");
  } catch {
    return {};
  }
}
