/**
 * Client-side SSE frame parsing for the chat stream (contract 6's wire format).
 *
 * `decodeSSE` (packages/shared/src/stream.ts) is frozen and throws if a frame's
 * payload isn't valid JSON. A single malformed frame — a truncated chunk at a
 * connection hiccup, a partial write — must never take down the read loop, so
 * this wrapper is the boundary that turns "throw" into "skip and keep going".
 */
import { decodeSSE, type StreamEvent } from "@mola/shared";

export type ParsedChunk = {
  /** Successfully decoded events, in frame order. */
  events: StreamEvent[];
  /** Trailing partial frame to prepend to the next chunk. */
  rest: string;
};

/**
 * Splits a buffer (one or more `\n\n`-delimited SSE frames, possibly with a
 * trailing incomplete one) into decoded events. Frames that fail to parse or
 * fail schema validation are dropped, not thrown.
 */
export function parseSSEChunk(buffer: string): ParsedChunk {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: StreamEvent[] = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    try {
      const ev = decodeSSE(trimmed);
      if (ev) events.push(ev);
    } catch {
      // Malformed frame (bad JSON, etc.) — drop it and keep streaming.
    }
  }

  return { events, rest };
}
