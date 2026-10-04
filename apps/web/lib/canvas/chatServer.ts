/**
 * The canvas chat's rows, for its routes (app/api/canvas/[canvasId]/chat):
 * the caller's chat for a canvas, its messages as the panel gets them,
 * keeping its edit log (lib/canvas/editLog.ts) in step with the board, and
 * keeping what the AI placed until a page has put it on the board.
 */
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { canvasPayloadSchema, type CanvasElement } from "@mola/shared";
import { canvasAiEdits, chats, messages, db, type DB } from "@mola/db";
import { AuthzError, requireOwned, type Session } from "@/lib/auth/ownership";
import { readCanvas, type LabelMap } from "./textSyntax";
import type { CanvasChatMessage, CanvasContext, PendingAIEdit } from "./chat";
import { describeEdit, diffSnapshots, mergeEdit, snapshotBoard, type BoardSnapshot, type CanvasEdit, type EditActor } from "./editLog";

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
type ChatRow = typeof chats.$inferSelect;
type MessageRow = typeof messages.$inferSelect;

/** What chats.canvas_snapshot holds: the board as the edit log last saw it, and the canvas version that was. */
export type StoredSnapshot = BoardSnapshot & { version: number };

/** The canvas, if the caller owns it — the same check the canvas actions make (lib/canvas/actions.ts). */
export async function requireOwnCanvas(canvasId: string, session: Session) {
  const row = await requireOwned("artifact", canvasId, session);
  if (row.kind !== "canvas") throw new AuthzError(404, "canvas not found");
  return row;
}

export async function findCanvasChat(canvasId: string, userId: string) {
  const [chat] = await db.select().from(chats)
    .where(and(eq(chats.canvasId, canvasId), eq(chats.userId, userId)))
    .orderBy(asc(chats.createdAt)).limit(1);
  return chat ?? null;
}

export function toClientMessage(m: MessageRow): CanvasChatMessage {
  if (m.role === "event") return { id: m.id, role: "event", content: m.content, event: m.event as CanvasEdit };
  return {
    id: m.id, role: m.role === "user" ? "user" : "assistant", content: m.content,
    status: m.status, errorMessage: m.errorMessage, canvasContext: m.canvasContext as CanvasContext | null, annotationId: m.annotationId,
  };
}

/** The chat row, locked for the rest of `tx` — every sync of its edit log, and every message sent in it, takes this lock first. */
export async function lockChat(tx: Tx, chatId: string): Promise<ChatRow> {
  const [chat] = await tx.select().from(chats).where(eq(chats.id, chatId)).for("update");
  return chat!;
}

/**
 * Brings the chat's edit log up to the canvas as saved: reads the board
 * with the chat's labels, tells what changed since the snapshot the chat
 * kept, and writes each change as a message with role "event" — folded
 * into the newest message instead when that is an entry this one carries on
 * from. Then keeps the new labels and snapshot. A chat with no snapshot yet
 * only takes one: its first message read the whole board anyway. The
 * changes are `actor`'s, but for what the AI added — its annotations, saved
 * by the canvas page like any change — which are the AI's (diffSnapshots).
 *
 * Call with `chat` locked in `tx` (lockChat), so two syncs never interleave.
 * Returns the entries written or rewritten, and the read when there was one
 * (none when the log was already up to date).
 */
export async function syncEditLog(
  tx: Tx, chat: ChatRow, canvas: { payload: unknown; version: number }, actor: EditActor = "user",
): Promise<{ written: MessageRow[]; read: ReturnType<typeof readCanvas> | null }> {
  const stored = chat.canvasSnapshot as StoredSnapshot | null;
  if (stored?.version === canvas.version) return { written: [], read: null };

  const { elements } = canvasPayloadSchema.parse(canvas.payload);
  const read = readCanvas(elements, { labels: (chat.canvasLabels as LabelMap | null) ?? undefined });
  const snapshot = snapshotBoard(elements, read.doc);
  const edits = stored ? diffSnapshots(stored, snapshot, actor) : [];

  const written = new Map<string, MessageRow>();
  let [newest] = edits.length > 0
    ? await tx.select().from(messages).where(eq(messages.chatId, chat.id)).orderBy(desc(messages.createdAt)).limit(1)
    : [];
  for (const edit of edits) {
    const merged = newest?.role === "event" ? mergeEdit(newest.event as CanvasEdit, edit) : null;
    const event = merged ?? edit;
    const [row] = merged
      ? await tx.update(messages).set({ event, content: describeEdit(event) }).where(eq(messages.id, newest!.id)).returning()
      // clock_timestamp(), not now(): the transaction's start time could order an entry before a message it came after.
      : await tx.insert(messages).values({
        userId: chat.userId, chatId: chat.id, role: "event", content: describeEdit(event), event, createdAt: sql`clock_timestamp()`,
      }).returning();
    newest = row!;
    written.set(row!.id, row!);
  }

  const kept: StoredSnapshot = { version: canvas.version, ...snapshot };
  await tx.update(chats).set({ canvasLabels: read.labels, canvasSnapshot: kept }).where(eq(chats.id, chat.id));
  return { written: [...written.values()], read };
}

// ── what the AI placed, until a page has put it on the board ────────────────
//
// The open canvas page adds the AI's edits and saves them itself; the server
// never writes the canvas. So each is kept (canvas_ai_edits) from the moment
// it is placed until a save acknowledges it, and one no page could add — a
// tab closed mid-reply, a dropped stream, a failed save — goes to the next
// page that opens the canvas or syncs its chat. A page acknowledges what it
// added with the save after, whether it is still on the board or already
// erased or undone, so an edit the student took away never comes back.

/** Keeps what a reply placed, before it goes out to the page. */
export async function recordAIEdits(canvasId: string, userId: string, messageId: string, elements: CanvasElement[]) {
  if (elements.length === 0) return;
  await db.insert(canvasAiEdits).values(elements.map((element) => ({
    id: element.id, userId, canvasId, messageId, element,
    // Per row, so edits placed together keep their order.
    createdAt: sql`clock_timestamp()`,
  })));
}

/** The canvas's AI edits no save has acknowledged yet, oldest first. */
export async function pendingAIEdits(canvasId: string): Promise<PendingAIEdit[]> {
  const rows = await db.select({ messageId: canvasAiEdits.messageId, element: canvasAiEdits.element }).from(canvasAiEdits)
    .where(and(eq(canvasAiEdits.canvasId, canvasId), isNull(canvasAiEdits.appliedAt)))
    .orderBy(asc(canvasAiEdits.createdAt));
  return rows.map((r) => ({ messageId: r.messageId, element: r.element as CanvasElement }));
}

/** Marks those of `ids` that are the canvas's pending AI edits as applied — call in the transaction of the save that acknowledges them. */
export async function markAIEditsApplied(tx: Tx, canvasId: string, ids: string[]) {
  if (ids.length === 0) return;
  await tx.update(canvasAiEdits).set({ appliedAt: sql`now()` })
    .where(and(eq(canvasAiEdits.canvasId, canvasId), isNull(canvasAiEdits.appliedAt), inArray(canvasAiEdits.id, ids)));
}
