/**
 * The Ollama provider sends a conversation's tool calls and their results
 * back in Ollama's own fields (tool_calls, tool_name), not as bare text —
 * without them the model can't see that it already called a tool.
 */
import { afterEach, describe, expect, it } from "vitest";
import { OllamaProvider } from "../lib/llm/ollama";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("ollama chat provider — tool calls in the history", () => {
  it("sends the assistant's tool calls, and each result with its tool's name", async () => {
    let body: { messages: unknown[] } | null = null;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      body = JSON.parse(String(init!.body));
      return new Response(`${JSON.stringify({ message: { content: "done" }, done: true, done_reason: "stop" })}\n`, { status: 200 });
    }) as unknown as typeof fetch;

    const input = { annotations: [{ target: "T1 word 5", kind: "error", mark: "circle", note: "4, not 5." }] };
    for await (const _ of new OllamaProvider("test-model", false).stream({
      system: "s",
      messages: [
        { role: "user", content: "Check my work." },
        { role: "assistant", content: "One slip.", toolCalls: [{ id: "c1", name: "annotate_canvas", input }] },
        { role: "tool", content: "Placed 1 annotation.", toolCallId: "c1" },
      ],
    })) { /* drain */ }

    expect(body!.messages).toEqual([
      { role: "system", content: "s" },
      { role: "user", content: "Check my work." },
      { role: "assistant", content: "One slip.", tool_calls: [{ function: { name: "annotate_canvas", arguments: input } }] },
      { role: "tool", content: "Placed 1 annotation.", tool_name: "annotate_canvas" },
    ]);
  });
});
