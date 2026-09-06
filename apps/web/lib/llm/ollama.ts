import type { ProviderStreamEvent } from "@mola/shared";
import { modelSupportsThinking } from "./models";
import type { CompletionRequest, LLMProvider, Message } from "./types";

// OLLAMA_HOST is often set as a bare `host:port` (the `ollama` CLI's own
// convention), which fetch()/URL reject outright — default it to http://.
const rawHost = process.env.OLLAMA_HOST ?? "192.168.1.17:11434";
export const HOST = /^https?:\/\//.test(rawHost) ? rawHost : `http://${rawHost}`;
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

/**
 * A thinking-capable model's hidden reasoning counts against this same output
 * budget — confirmed live against gemma4:12b, which spent all 2048 tokens on
 * `message.thinking` and stopped with done_reason "length" before emitting a
 * single visible content token (loop.ts now surfaces that case as an error
 * rather than persisting silence, but a larger budget makes it rarer).
 */
const DEFAULT_NUM_PREDICT = Number(process.env.OLLAMA_NUM_PREDICT ?? 8192);

/**
 * Ollama defaults num_ctx to 4096 regardless of what the model itself
 * supports (gemma4:12b's real ceiling is 262144) unless a request asks for
 * more explicitly — confirmed live via /api/ps. This is the *total* window
 * shared by the prompt (system + history + tools) and num_predict together,
 * not a separate allowance, so raising it is what actually gives a long
 * conversation and a generous num_predict room to coexist.
 */
const DEFAULT_NUM_CTX = Number(process.env.OLLAMA_NUM_CTX ?? 65536);

type OllamaChunk = {
  message?: { content?: string; tool_calls?: { function: { name: string; arguments: unknown } }[] };
  done?: boolean;
  done_reason?: string;
};

/** Chat only — deliberately no `embed` here (contract 3). */
export class OllamaProvider implements LLMProvider {
  readonly id = "ollama";
  private readonly think: boolean;

  constructor(
    private readonly model: string = DEFAULT_CHAT_MODEL,
    /** Suppress-only: when false, message.thinking (if any) is simply never read below. */
    think: boolean = true,
  ) {
    // Enforced here, not just by callers (lib/llm/index.ts's ollamaProviderFor) —
    // Ollama hard-errors ("does not support thinking") on think:true for a model
    // that doesn't declare support, so this must hold no matter how the class is
    // constructed, not just through the one call path that currently exists.
    this.think = think && modelSupportsThinking(this.model);
  }

  async *stream(req: CompletionRequest): AsyncIterable<ProviderStreamEvent> {
    yield* this.attempt(req, this.think, this.think);
  }

  /**
   * One HTTP round-trip. Split out from `stream()` so a fully-empty,
   * budget-exhausted attempt (see below) can retry itself once with
   * thinking off, rather than that recovery living in the frozen agent
   * loop (contract 4) — this is an Ollama-specific quirk, not a generic
   * provider concern.
   */
  private async *attempt(
    req: CompletionRequest,
    think: boolean,
    allowRetry: boolean,
  ): AsyncGenerator<ProviderStreamEvent> {
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
        think,
        options: {
          temperature: req.temperature ?? 0.7,
          num_predict: req.maxTokens ?? DEFAULT_NUM_PREDICT,
          num_ctx: DEFAULT_NUM_CTX,
        },
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
    // Nothing user-visible yielded yet this attempt — tracked so a
    // done_reason "length" with this still false (below) is known to be
    // fully silent, safe to retry rather than surface as a failed turn.
    let sawOutput = false;

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
          sawOutput = true;
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
        if (text) {
          sawOutput = true;
          yield { type: "text_delta", text };
        }

        if (chunk.done) {
          // A thinking-capable model can spend its entire output budget on
          // hidden reasoning and stop with done_reason "length" having
          // never emitted a single visible token or tool call — confirmed
          // live against gemma4:12b, and it recurs on any question whose
          // reasoning is long enough for whatever num_predict is set to,
          // so raising that ceiling only postpones it. Since nothing has
          // reached the consumer yet in exactly this case, it's safe to
          // swallow this attempt and substitute one retry with thinking
          // off — full budget goes to the answer instead of reasoning.
          if (!sawOutput && chunk.done_reason === "length" && allowRetry) {
            stall.clear();
            yield* this.attempt(req, false, false);
            return;
          }
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
      if (err instanceof Error && err.name === "AbortError") {
        yield { type: "error", message: "request aborted (client disconnected or stopped generation)" };
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
