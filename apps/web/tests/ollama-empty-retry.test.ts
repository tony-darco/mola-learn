/**
 * A thinking model that ends a call having said nothing — no words, no tool
 * call — is asked again once (lib/llm/ollama.ts): gemma4:12b does it on
 * the canvas chat after thinking out a plan, and the student would get an
 * empty reply. The caller sees only the call that answered.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { ProviderStreamEvent } from "@mola/shared";
import { OllamaProvider } from "../lib/llm/ollama";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const chunk = (message: Record<string, unknown>, done_reason?: string) => `${JSON.stringify({ message, ...(done_reason ? { done: true, done_reason } : {}) })}\n`;
const EMPTY = chunk({ content: "", thinking: "Plan: annotate M8 row 1 col 4." }, "stop");
const CUT = chunk({ content: "", thinking: "Let me work through every step…" }, "length");
const ANSWER = chunk({ content: "2 + 2 is 4." }, "stop");

/** What a caller sees from `model` when Ollama answers its requests with `responses` in turn, and how it was asked. */
async function run(model: string, think: boolean, responses: string[]) {
  const asked: { think: boolean }[] = [];
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    asked.push({ think: JSON.parse(String(init!.body)).think });
    return new Response(responses[Math.min(asked.length, responses.length) - 1], { status: 200 });
  }) as unknown as typeof fetch;
  const events: ProviderStreamEvent[] = [];
  for await (const ev of new OllamaProvider(model, think).stream({ system: "s", messages: [{ role: "user", content: "Check my work." }] })) events.push(ev);
  return { events, asked };
}
const text = (events: ProviderStreamEvent[]) => events.flatMap((e) => (e.type === "text_delta" ? [e.text] : [])).join("");

describe("ollama chat provider — a call that says nothing", () => {
  it("asks again, once, with thinking as before, and gives the caller the answer alone", async () => {
    const { events, asked } = await run("gemma4:12b", true, [EMPTY, ANSWER]);
    expect(asked).toEqual([{ think: true }, { think: true }]);
    expect(text(events)).toBe("2 + 2 is 4.");
    expect(events.filter((e) => e.type === "done")).toEqual([{ type: "done", stopReason: "end_turn" }]);
  });

  it("gives up after that one: a second empty call is the caller's, as it was", async () => {
    const { events, asked } = await run("gemma4:12b", true, [EMPTY, EMPTY, ANSWER]);
    expect(asked).toHaveLength(2);
    expect(text(events)).toBe("");
    expect(events.filter((e) => e.type === "done")).toHaveLength(1);
  });

  it("still turns thinking off when the budget ran out in thinking", async () => {
    const { events, asked } = await run("gemma4:12b", true, [CUT, ANSWER]);
    expect(asked).toEqual([{ think: true }, { think: false }]);
    expect(text(events)).toBe("2 + 2 is 4.");
  });

  it("takes a tool call, or any words, as an answer, and leaves a model that doesn't think alone", async () => {
    const call = chunk({ content: "", tool_calls: [{ function: { name: "annotate_canvas", arguments: { annotations: [] } } }] }, "stop");
    expect((await run("gemma4:12b", true, [call, ANSWER])).asked).toHaveLength(1);
    expect((await run("gemma4:12b", true, [ANSWER, ANSWER])).asked).toHaveLength(1);
    expect((await run("test-model", false, [EMPTY, ANSWER])).asked).toHaveLength(1);
  });
});
