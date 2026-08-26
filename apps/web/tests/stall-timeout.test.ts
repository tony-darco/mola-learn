/**
 * Regression test for the hang Agent C hit: a stalled Ollama host left the
 * request open forever. Chat uses an INACTIVITY timeout (a long generation is
 * legitimate; silence is not); embedding uses a total-duration cap.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.unstubAllEnvs();
});

describe("ollama chat provider — stall timeout", () => {
  it("aborts and reports when the response body goes silent", async () => {
    vi.stubEnv("OLLAMA_STALL_TIMEOUT_MS", "150");
    vi.resetModules();

    // A body that yields one chunk then never resolves again — the exact shape
    // of the hang: connection open, headers received, no further tokens.
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(JSON.stringify({ message: { content: "hi" } }) + "\n"),
          );
          init?.signal?.addEventListener("abort", () => controller.error(new Error("aborted")));
          // then nothing, forever
        },
      });
      return new Response(stream, { status: 200 });
    }) as unknown as typeof fetch;

    const { OllamaProvider } = await import("../lib/llm/ollama");
    const events: string[] = [];
    for await (const ev of new OllamaProvider("test-model").stream({
      system: "s",
      messages: [{ role: "user", content: "hello" }],
    })) {
      events.push(ev.type);
      if (ev.type === "error") {
        expect(ev.message).toMatch(/stalled/);
        break;
      }
    }

    expect(events).toContain("text_delta"); // the first chunk did arrive
    expect(events).toContain("error");      // and then the stall was caught
  }, 10_000);

  it("does not abort a slow but progressing stream", async () => {
    vi.stubEnv("OLLAMA_STALL_TIMEOUT_MS", "200");
    vi.resetModules();

    globalThis.fetch = (async () => {
      const enc = new TextEncoder();
      let sent = 0;
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          // Six chunks at 100ms — total 600ms, well past the 200ms stall
          // window, but never silent for that long. Must survive.
          await new Promise((r) => setTimeout(r, 100));
          if (sent++ < 5) {
            controller.enqueue(enc.encode(JSON.stringify({ message: { content: "x" } }) + "\n"));
          } else {
            controller.enqueue(enc.encode(JSON.stringify({ done: true }) + "\n"));
            controller.close();
          }
        },
      });
      return new Response(stream, { status: 200 });
    }) as unknown as typeof fetch;

    const { OllamaProvider } = await import("../lib/llm/ollama");
    const events: string[] = [];
    for await (const ev of new OllamaProvider("test-model").stream({
      system: "s",
      messages: [{ role: "user", content: "hello" }],
    })) {
      events.push(ev.type);
    }

    expect(events).not.toContain("error");
    expect(events).toContain("done");
  }, 10_000);
});
