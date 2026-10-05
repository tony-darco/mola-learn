/**
 * gemma4:26b sometimes writes a tool call into its visible text instead of
 * making it. For a request that offered tools, the Ollama provider takes a
 * call written out for one of them back out of the text and makes it a
 * tool call.
 */
import { afterEach, describe, expect, it } from "vitest";
import { OllamaProvider, ToolCallLeakFilter } from "../lib/llm/ollama";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const ANNOTATE = { name: "annotate_canvas", description: "d", parameters: { type: "object" } };

/** The text and tool calls a caller sees when Ollama streams `contents` as one chunk each. */
async function seen(contents: string[], offered = [ANNOTATE]) {
  const lines = contents.map((content, i) => JSON.stringify({
    message: { content }, ...(i === contents.length - 1 ? { done: true, done_reason: "stop" } : {}),
  }));
  globalThis.fetch = (async () => new Response(`${lines.join("\n")}\n`, { status: 200 })) as unknown as typeof fetch;
  let text = "";
  const calls: { name: string; input: unknown }[] = [];
  for await (const ev of new OllamaProvider("test-model", false).stream({ system: "s", messages: [{ role: "user", content: "Check my work." }], tools: offered })) {
    if (ev.type === "text_delta") text += ev.text;
    if (ev.type === "tool_call") calls.push({ name: ev.name, input: ev.input });
  }
  return { text, calls };
}

const annotation = { kind: "error", mark: "underline", note: "That's not quite right. What is 2 + 2?", target: "X1 word 15" };

describe("ollama chat provider — a tool call written out as text", () => {
  it("makes the call the canvas chat saw written out, keys unquoted, and keeps the words around it", async () => {
    const r = await seen([
      "It looks like you've written a sentence and a math problem.\n\n<call:annotate_canvas>{annotations:[{kind:\"error\",mark:\"underline\",",
      "note:\"That's not quite right. What is 2 + 2?\",target:\"X1 word 15\"}]}</call:annotate_canvas>",
      " Take another look.",
    ]);
    expect(r.calls).toEqual([{ name: "annotate_canvas", input: { annotations: [annotation] } }]);
    expect(r.text).toBe("It looks like you've written a sentence and a math problem.\n\n Take another look.");
  });

  it("drops the closing tag when it streams in after the call, split across chunks", async () => {
    const r = await seen([
      "Here's a note.\n\n<call:annotate_canvas>{annotations:[{kind:\"error\",mark:\"underline\",note:\"That's not quite right. What is 2 + 2?\",target:\"X1 word 15\"}]}",
      "</",
      "call:annotate_canvas>",
      " Take another look.",
    ]);
    expect(r.calls).toEqual([{ name: "annotate_canvas", input: { annotations: [annotation] } }]);
    expect(r.text).toBe("Here's a note.\n\n Take another look.");
  });

  it("reads gemma's own call format, quote tokens and all, and a bare call", async () => {
    const native = await seen(['<|tool_call>call:annotate_canvas{annotations:[{target:<|"|>T1 word 5<|"|>,note:<|"|>Say "4".<|"|>}]}<tool_call|>']);
    expect(native.calls).toEqual([{ name: "annotate_canvas", input: { annotations: [{ target: "T1 word 5", note: 'Say "4".' }] } }]);
    expect(native.text).toBe("");
    const bare = await seen(['Here: call:annotate_canvas{"annotations": [{"target": "T1 word 5", "note": "a, b: c"}]}']);
    expect(bare.calls).toEqual([{ name: "annotate_canvas", input: { annotations: [{ target: "T1 word 5", note: "a, b: c" }] } }]);
    expect(bare.text).toBe("Here: ");
  });

  it("leaves words alone: a tool that wasn't offered, a request with no tools, a call that never closes, and prose", async () => {
    const other = '<call:erase_board>{all:true}</call:erase_board>';
    expect(await seen([other])).toEqual({ text: other, calls: [] });
    expect(await seen(["<call:annotate_canvas>{annotations:[]}</call:annotate_canvas>"], [])).toEqual({ text: "<call:annotate_canvas>{annotations:[]}</call:annotate_canvas>", calls: [] });
    expect(await seen(["<call:annotate_canvas>{annotations:[{target:"])).toEqual({ text: "<call:annotate_canvas>{annotations:[{target:", calls: [] });
    expect(await seen(["You can call: me", " any time <3, ", "c"])).toEqual({ text: "You can call: me any time <3, c", calls: [] });
  });

  it("holds only what could still become a call", () => {
    const f = new ToolCallLeakFilter(["annotate_canvas"]);
    expect(f.push("Look at T1 <cal")).toEqual([{ text: "Look at T1 " }]);
    expect(f.push("m down")).toEqual([{ text: "<calm down" }]);
    expect(f.end()).toEqual([]);
  });
});
