/**
 * gemma4:26b sometimes opens a call's visible text with its thinking
 * channel's header ("thought\n…"). The Ollama provider drops the header, and
 * any thinking up to the channel's close marker, before the text reaches a
 * caller — the canvas chat and the main chat alike.
 */
import { afterEach, describe, expect, it } from "vitest";
import { ChannelLeakFilter, OllamaProvider } from "../lib/llm/ollama";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** What a caller sees when Ollama streams `contents` as one chunk each. */
async function visible(contents: string[]): Promise<string> {
  const lines = contents.map((content, i) => JSON.stringify({
    message: { content }, ...(i === contents.length - 1 ? { done: true, done_reason: "stop" } : {}),
  }));
  globalThis.fetch = (async () => new Response(`${lines.join("\n")}\n`, { status: 200 })) as unknown as typeof fetch;
  let text = "";
  for await (const ev of new OllamaProvider("test-model", false).stream({ system: "s", messages: [{ role: "user", content: "Check my work." }] })) {
    if (ev.type === "text_delta") text += ev.text;
  }
  return text;
}

describe("ollama chat provider — a leaked thinking channel", () => {
  it("drops the header in front of the answer, as the eval saw it", async () => {
    expect(await visible(["thought\nWhen you performed ", "R3 = R3 - R1, the third column changed."]))
      .toBe("When you performed R3 = R3 - R1, the third column changed.");
  });

  it("drops an empty thought, and thinking up to the close marker", async () => {
    expect(await visible(["thought\n<channel|>"])).toBe("");
    expect(await visible(["thou", "ght\nThe student subtracted", " wrongly.<chan", "nel|>\n\n3 − 2 is 1, not 5."])).toBe("3 − 2 is 1, not 5.");
    expect(await visible(["<|channel>thought\n<channel|>2 + 2 is 4."])).toBe("2 + 2 is 4.");
  });

  it("leaves ordinary text alone, however it starts", async () => {
    expect(await visible(["Your sum is right."])).toBe("Your sum is right.");
    expect(await visible(["thou", "gh the steps are right, 3 − 2 is 1."])).toBe("though the steps are right, 3 − 2 is 1.");
    expect(await visible(["\n", "thought it through? Check M8."])).toBe("\nthought it through? Check M8.");
    expect(await visible(["thought"])).toBe("thought");
  });

  it("holds nothing back once the start is known", () => {
    const f = new ChannelLeakFilter();
    expect(f.push("Fine")).toBe("Fine");
    expect(f.push(" so far.")).toBe(" so far.");
    expect(f.end()).toBe("");
  });
});
