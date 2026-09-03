import type { ProviderStreamEvent } from "@mola/shared";
import type { CompletionRequest, LLMProvider, Message } from "./types";

// OLLAMA_HOST is often set as a bare `host:port` (the `ollama` CLI's own
// convention), which fetch()/URL reject outright — default it to http://.
const rawHost = process.env.OLLAMA_HOST ?? "127.0.0.1:11434";
const HOST = /^https?:\/\//.test(rawHost) ? rawHost : `http://${rawHost}`;
export const DEFAULT_CHAT_MODEL = process.env.MOLA_CHAT_MODEL ?? "qwen3.6:27b";

/**
 * Inactivity timeout, not a total-duration cap.
 *
 * A legitimate generation on a 27B reasoning model can run for minutes, so a
 * total timeout would kill good requests. What is never legitimate is the
 * connection going silent: no headers, or no token for this long. Without this
 * a stalled Ollama host hangs the request forever — which is exactly what
 * happened to the retrieval golden-set harness before it was found.
 */
const STALL_TIMEOUT_MS = Number(process.env.OLLAMA_STALL_TIMEOUT_MS ?? 120_000);

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

    // Composed so a caller-supplied signal (client disconnect) and the stall
    // timeout both abort the request; whichever fires first wins.
    const stall = new StallTimer(STALL_TIMEOUT_MS);
    const signal = req.signal
      ? AbortSignal.any([req.signal, stall.signal])
      : stall.signal;

    const res = await fetch(`${HOST}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal,
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
      stall.clear();
      yield { type: "error", message: `ollama ${res.status}: ${await res.text()}` };
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      stall.kick(); // bytes arrived — restart the silence clock
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
            // A per-stream() counter collides across react-loop iterations:
            // getChatProvider's LazyProvider resolves a *new* OllamaProvider
            // on every call() (lib/llm/index.ts), so a locally-scoped
            // "call_1", "call_2", ... counter restarted at 1 each iteration
            // and produced duplicate ids within a single turn (React "two
            // children with the same key" on the activity-row list, and a
            // second tool call's `tool_call_end` patching the first one's
            // row instead of its own). A process-wide unique id sidesteps
            // it regardless of how many provider instances get constructed.
            type: "tool_call",
            id: crypto.randomUUID(),
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
    } catch (err) {
      if (stall.fired) {
        yield {
          type: "error",
          message: `ollama stalled: no data for ${STALL_TIMEOUT_MS}ms`,
        };
        return;
      }
      throw err;
    } finally {
      stall.clear();
    }
  }
}

/** Aborts when no progress has been reported for `ms`. Reset with `kick()`. */
class StallTimer {
  private readonly controller = new AbortController();
  private timer: ReturnType<typeof setTimeout> | undefined;
  fired = false;

  constructor(private readonly ms: number) {
    this.kick();
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  kick(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.fired = true;
      this.controller.abort();
    }, this.ms);
  }

  clear(): void {
    clearTimeout(this.timer);
  }
}
