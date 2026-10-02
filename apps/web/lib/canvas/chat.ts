/**
 * The canvas chat's wire format, shared by its route
 * (app/api/canvas/[canvasId]/chat) and the panel on the canvas page.
 *
 * Its own small event set rather than the main chat's (contract 6): no
 * tools, artifacts or hints here, and the first event has to carry what the
 * model was shown. Same SSE framing — one JSON object per `data:` line.
 */
import type { Rect } from "./marquee";

/** POST body. Without a selection the server reads the whole board. */
export type CanvasChatRequest = { message: string; selection?: { rect: Rect } };

/**
 * What the model was shown with one message: the canvas as text, and the
 * selected rectangle it was limited to (null: the whole board). Stored on
 * the user's message (messages.canvas_context).
 */
export type CanvasContext = { text: string; region: Rect | null };

export type CanvasChatEvent =
  /** Always first: the stored user message, the assistant message being generated, and exactly what the model was given. */
  | ({ type: "canvas_context"; userMessageId: string; messageId: string } & CanvasContext)
  | { type: "text_delta"; text: string }
  | { type: "message_end"; messageId: string }
  | { type: "error"; message: string };

/** A stored message, as GET returns it. */
export type CanvasChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "streaming" | "done" | "error";
  errorMessage: string | null;
  canvasContext: CanvasContext | null;
};

export function encodeCanvasChatEvent(event: CanvasChatEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** Splits a buffer into whole events and the trailing partial frame; a malformed frame is dropped, not thrown. */
export function parseCanvasChatEvents(buffer: string): { events: CanvasChatEvent[]; rest: string } {
  const frames = buffer.split("\n\n");
  const rest = frames.pop() ?? "";
  const events: CanvasChatEvent[] = [];
  for (const frame of frames) {
    if (!frame.startsWith("data: ")) continue;
    try {
      events.push(JSON.parse(frame.slice(6)) as CanvasChatEvent);
    } catch {
      // Keep streaming past a bad frame.
    }
  }
  return { events, rest };
}
