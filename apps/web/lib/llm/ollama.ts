import type { ProviderStreamEvent } from "@mola/shared";
import type { CompletionRequest, LLMProvider, Message } from "./types";

const HOST = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
export const DEFAULT_CHAT_MODEL = process.env.MOLA_CHAT_MODEL ?? "qwen3.5:27b";

type OllamaChunk = {
  message?: { content?: string; tool_calls?: { function: { name: string; arguments: unknown } }[] };
  done?: boolean;
  done_reason?: string;
};

/** Chat only — deliberately no `embed` here (contract 3). */
export class OllamaProvider implements LLMProvider {
  readonly id = "ollama";
  constructor(private readonly model: string = DEFAULT_CHAT_MODEL) {}

  async *stream(req: CompletionRequest): AsyncIterable<ProviderStreamEvent> {
    const messages: Message[] = [{ role: "system", content: req.system }, ...req.messages];

    const res = await fetch(`${HOST}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: req.signal,
      body: JSON.stringify({
        model: this.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
        options: { temperature: req.temperature ?? 0.7, num_predict: req.maxTokens ?? 2048 },
        ...(req.tools?.length
          ? {
              tools: req.tools.map((t) => ({
                type: "function",
                function: { name: t.name, description: t.description, parameters: t.parameters },
              })),
            }
          : {}),
      }),
    });

    if (!res.ok || !res.body) {
      yield { type: "error", message: `ollama ${res.status}: ${await res.text()}` };
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let toolCallSeq = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Ollama emits newline-delimited JSON; the last fragment may be partial.
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        let chunk: OllamaChunk;
        try {
          chunk = JSON.parse(line);
        } catch {
          continue;
        }

        for (const call of chunk.message?.tool_calls ?? []) {
          yield {
            type: "tool_call",
            id: `call_${++toolCallSeq}`,
            name: call.function.name,
            input: call.function.arguments,
          };
        }

        const text = chunk.message?.content;
        if (text) yield { type: "text_delta", text };

        if (chunk.done) {
          yield {
            type: "done",
            stopReason: chunk.done_reason === "length" ? "max_tokens" : "end_turn",
          };
        }
      }
    }
  }
}
