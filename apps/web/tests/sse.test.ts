/**
 * SSE frame parsing for the streaming client (components/chat/sse.ts).
 *
 * decodeSSE (packages/shared/src/stream.ts, frozen) throws on invalid JSON.
 * parseSSEChunk is the boundary that turns one bad frame into "skip it" rather
 * than a thrown exception that would kill the read loop mid-stream.
 */
import { describe, expect, it } from "vitest";
import { encodeSSE } from "@mola/shared";
import { parseSSEChunk } from "../components/chat/sse";

describe("parseSSEChunk", () => {
  it("decodes a single well-formed frame", () => {
    const chunk = encodeSSE({ type: "text_delta", text: "hi" });
    const { events, rest } = parseSSEChunk(chunk);
    expect(events).toEqual([{ type: "text_delta", text: "hi" }]);
    expect(rest).toBe("");
  });

  it("decodes multiple frames arriving in one chunk", () => {
    const chunk =
      encodeSSE({ type: "text_delta", text: "a" }) +
      encodeSSE({ type: "text_delta", text: "b" });
    const { events } = parseSSEChunk(chunk);
    expect(events.map((e) => (e.type === "text_delta" ? e.text : null))).toEqual(["a", "b"]);
  });

  it("carries an incomplete trailing frame into `rest` instead of dropping it", () => {
    const complete = encodeSSE({ type: "text_delta", text: "done" });
    const partial = 'data: {"type":"text_delta","tex';
    const { events, rest } = parseSSEChunk(complete + partial);
    expect(events).toHaveLength(1);
    expect(rest).toBe(partial);
  });

  it("skips a malformed frame (invalid JSON) without throwing", () => {
    const good1 = encodeSSE({ type: "text_delta", text: "before" });
    const malformed = "data: {not json at all}\n\n";
    const good2 = encodeSSE({ type: "text_delta", text: "after" });

    expect(() => parseSSEChunk(good1 + malformed + good2)).not.toThrow();
    const { events } = parseSSEChunk(good1 + malformed + good2);
    expect(events.map((e) => (e.type === "text_delta" ? e.text : null))).toEqual(["before", "after"]);
  });

  it("skips a frame that is valid JSON but fails the StreamEvent schema", () => {
    const good = encodeSSE({ type: "text_delta", text: "ok" });
    const wrongShape = 'data: {"type":"not_a_real_event","foo":"bar"}\n\n';
    const { events } = parseSSEChunk(good + wrongShape);
    expect(events).toEqual([{ type: "text_delta", text: "ok" }]);
  });

  it("ignores blank lines between frames", () => {
    const chunk = `${encodeSSE({ type: "text_delta", text: "x" })}\n`;
    const { events } = parseSSEChunk(chunk);
    expect(events).toEqual([{ type: "text_delta", text: "x" }]);
  });
});
