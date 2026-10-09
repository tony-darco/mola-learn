/**
 * The canvas chat's wire format, shared by its route
 * (app/api/canvas/[canvasId]/chat) and the panel on the canvas page.
 *
 * Its own small event set rather than the main chat's (contract 6): no
 * artifacts or hints here, its one tool's results are drawn on the board
 * rather than shown in the chat, and the first event has to carry what the
 * model was shown. Same SSE framing — one JSON object per `data:` line.
 */
import type { CanvasAnnotationElement, CanvasElement } from "@mola/shared";
import type { CanvasEdit } from "./editLog";
import type { Rect } from "./marquee";

/**
 * POST body. Without a selection the server reads the whole board. `annotationId`: the message is a reply
 * to that AI annotation, sent from its note on the board (stored as messages.annotation_id).
 */
export type CanvasChatRequest = { message: string; selection?: { rect: Rect }; annotationId?: string };

/** POST's 404 body when the annotation a reply is to isn't on the board as saved — erased meanwhile, here or in another tab. */
export const ANNOTATION_GONE = "annotation not found";

/** Why a message couldn't be sent, as its thread shows it: a reply to an annotation that is gone says so, not the status. */
export function sendFailure(status: number, body: unknown, annotationId: string | null): string {
  const error = body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
  if (annotationId && status === 404 && error === ANNOTATION_GONE) return "That annotation is no longer on the board.";
  return `request failed (${status})`;
}

/** The AI annotation a message replies to, as the model was told it: its K label, and what it said where. */
export type RepliedAnnotation = { label: string; kind: CanvasAnnotationElement["props"]["kind"]; target: string; note: string };

/**
 * What the model was shown with one message: the canvas as text, the
 * selected rectangle it was limited to (null: the whole board), what
 * changed on the board since the student's last message — the edit log's
 * entries, as the section before the board (absent when nothing did) — and,
 * for a reply to one of the AI's annotations, that annotation (replySection).
 * Stored on the user's message (messages.canvas_context).
 */
export type CanvasContext = { text: string; region: Rect | null; changes?: string; replyTo?: RepliedAnnotation };

/** What an annotation of each kind did to its place, as the edit log tells it (lib/canvas/editLog.ts). */
const ANNOTATED: Record<RepliedAnnotation["kind"], (on: string) => string> = {
  error: (on) => `marked ${on} as an error`, check: (on) => `marked ${on} as right`, hint: (on) => `left a hint on ${on}`, note: (on) => `left a note on ${on}`,
};

/** What the model reads, after the board, when the student's message is a reply to one of its annotations. */
export function replySection({ label, kind, target, note }: RepliedAnnotation): string {
  return `WHAT THE STUDENT IS REPLYING TO\nTheir message is a reply to your annotation ${label}, where you ${ANNOTATED[kind](target)}: "${note}"`;
}

export type CanvasChatEvent =
  /**
   * Always first: the stored user message, the assistant message being generated, and exactly what
   * the model was given — and the edit-log entries the message caught up on, which come before it.
   */
  | ({ type: "canvas_context"; userMessageId: string; messageId: string; edits: CanvasChatMessage[] } & CanvasContext)
  | { type: "text_delta"; text: string }
  /** An annotation the model just placed (lib/canvas/annotate.ts), for the canvas page to put on the board and save. */
  | { type: "annotation"; element: CanvasAnnotationElement }
  | { type: "message_end"; messageId: string }
  | { type: "error"; message: string };

/**
 * A stored message, as GET returns it: a turn, or an entry in the edit log (`content` is its sentence).
 * `annotationId`: the AI annotation a user's message replies to, kept after the annotation is gone; null otherwise.
 */
export type CanvasChatMessage =
  | {
    id: string;
    role: "user" | "assistant";
    content: string;
    status: "streaming" | "done" | "error";
    errorMessage: string | null;
    canvasContext: CanvasContext | null;
    annotationId: string | null;
  }
  | { id: string; role: "event"; content: string; event: CanvasEdit };

/**
 * POST …/chat/edits: the edit log brought up to the canvas as saved — the entries written or rewritten. `chatId` is null when
 * there's no chat to log into. `pending`: the AI's edits no save has acknowledged yet, for the page to add (chatServer.ts).
 */
export type CanvasEditsResponse = { chatId: string | null; entries: CanvasChatMessage[]; pending: PendingAIEdit[] };

/** An AI edit still to be put on the board, and the reply that placed it. */
export type PendingAIEdit = { messageId: string; element: CanvasElement };

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
