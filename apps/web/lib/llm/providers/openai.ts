/**
 * BYOK provider — OpenAI. Chat completions only, matching contract 3: this
 * class has no `embed` method, so a student's key can never reach the
 * platform-owned `EmbeddingProvider`.
 *
 * Plain `fetch`, same style as `OllamaProvider` — no SDK, and contract 3 keeps
 * every provider SDK (if one were ever added) inside `lib/llm/` regardless.
 */
import type { ProviderStreamEvent } from "@mola/shared";
import type { CompletionRequest, LLMProvider, Message } from "../types";

const DEFAULT_MODEL = "gpt-4o-mini";

type PendingToolCall = { id: string; name: string; args: string };

export class OpenAIProvider implements LLMProvider {
  readonly id = "openai";
  constructor(
    private readonly apiKey: string,
    private readonly model: string = DEFAULT_MODEL,
  ) {}

  async *stream(req: CompletionRequest): AsyncIterable<ProviderStreamEvent> {
    const allMessages: Message[] = [{ role: "system", content: req.system }, ...req.messages];
    const messages = allMessages.map(toOpenAIMessage);

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      signal: req.signal,
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: true,
        temperature: req.temperature ?? 0.7,
        max_tokens: req.maxTokens ?? 2048,
        ...(req.tools?.length
          ? { tools: req.tools.map((t) => ({ type: "function", function: t })) }
          : {}),
      }),
    });

    if (!res.ok || !res.body) {
      yield { type: "error", message: `openai ${res.status}: ${await res.text()}` };
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    // OpenAI streams tool-call arguments as incremental string fragments keyed
    // by index — unlike Ollama, which sends each call whole. Buffer until done.
    const pending = new Map<number, PendingToolCall>();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") {
          for (const call of pending.values()) {
            yield { type: "tool_call", id: call.id, name: call.name, input: safeParse(call.args) };
          }
          yield { type: "done", stopReason: "end_turn" };
          continue;
        }

        let chunk: OpenAIChunk;
        try {
          chunk = JSON.parse(payload);
        } catch {
          continue;
        }

        const delta = chunk.choices?.[0]?.delta;
        if (delta?.content) yield { type: "text_delta", text: delta.content };

        for (const tc of delta?.tool_calls ?? []) {
          const existing = pending.get(tc.index);
          if (existing) {
            existing.args += tc.function?.arguments ?? "";
          } else {
            pending.set(tc.index, {
              id: tc.id ?? `call_${tc.index}`,
              name: tc.function?.name ?? "",
              args: tc.function?.arguments ?? "",
            });
          }
        }

        const finish = chunk.choices?.[0]?.finish_reason;
        if (finish) {
          for (const call of pending.values()) {
            yield { type: "tool_call", id: call.id, name: call.name, input: safeParse(call.args) };
          }
          pending.clear();
          yield {
            type: "done",
            stopReason: finish === "length" ? "max_tokens" : finish === "tool_calls" ? "tool_use" : "end_turn",
          };
        }
      }
    }
  }
}

type OpenAIChunk = {
  choices?: {
    delta?: {
      content?: string;
      tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
    };
    finish_reason?: string | null;
  }[];
};

function toOpenAIMessage(m: Message) {
  if (m.role === "tool") {
    return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
  }
  if (m.toolCalls?.length) {
    return {
      role: m.role,
      content: m.content || null,
      tool_calls: m.toolCalls.map((c) => ({
        id: c.id, type: "function",
        function: { name: c.name, arguments: JSON.stringify(c.input) },
      })),
    };
  }
  return { role: m.role, content: m.content };
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json || "{}");
  } catch {
    return {};
  }
}
