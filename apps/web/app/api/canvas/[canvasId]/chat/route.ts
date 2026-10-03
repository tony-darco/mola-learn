/**
 * A canvas's own conversation — the chat panel on the canvas page.
 *
 * Each message goes to the model together with the canvas as text
 * (readCanvas) — the whole board, or only the rectangle the student
 * selected — and the reply streams back (lib/canvas/chat.ts has the event
 * format). The model has one tool, annotate_canvas: notes pinned to places
 * on the board, which stream out with the reply for the open canvas to add
 * and save (lib/canvas/chatTurn.ts runs the reply; this route never writes
 * the canvas itself). The first event carries exactly the canvas text the
 * model was given and the region it was limited to; the same is stored on
 * the user's message, so "What the AI saw" survives a reload.
 *
 * Stored as an ordinary chat (chats.canvas_id) so it can later be opened as a
 * normal chat. Labels (M1, Q2, …) stay the same across turns: the reader's
 * LabelMap is kept on the chat row (chats.canvas_labels) and handed back in.
 *
 * Between the turns sits the edit log (lib/canvas/editLog.ts): every change
 * to the board as an entry, role "event" (edits/route.ts writes them after
 * each save). A message first brings the log up to the board as saved, and
 * the model reads the entries since the student's last message as a section
 * before the board — they are never turns of their own.
 */
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { canvasPayloadSchema } from "@mola/shared";
import { artifacts, chats, db, messages, users } from "@mola/db";
import { authzResponse, requireSession } from "@/lib/auth/ownership";
import { CHAT_MODELS, DEFAULT_CHAT_MODEL, getChatProvider, type Message } from "@/lib/llm";
import { readCanvas, type LabelMap } from "@/lib/canvas/textSyntax";
import { MAX_ANNOTATIONS_PER_TURN } from "@/lib/canvas/annotate";
import { encodeCanvasChatEvent, type CanvasChatEvent, type CanvasContext } from "@/lib/canvas/chat";
import { changesSection, type CanvasEdit } from "@/lib/canvas/editLog";
import { findCanvasChat, lockChat, requireOwnCanvas, syncEditLog, toClientMessage } from "@/lib/canvas/chatServer";
import { runCanvasTurn } from "@/lib/canvas/chatTurn";
import { scriptedProvider } from "@/lib/canvas/scripted";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM = [
  "You are Mola, a tutor looking at a student's whiteboard. You can't see the board itself: "
    + "each of the student's messages comes with the board converted to text — all of it, or only the part they selected.",
  "Refer to things on the board by their labels (M1, Q2, T3, …), and to parts of handwriting by place (\"M1 row 2 col 3\"), as the text explains. "
    + "If something you need is unreadable or missing from the text, say so rather than guessing.",
  "You can also mark the board with the annotate_canvas tool: each annotation pins a short note to one place on the board, beside the student's work. "
    + "Use it when the student asks you to check their work, or when pointing at a spot makes your answer clearer — not for every reply.",
  "Point each annotation at the smallest place that holds what you mean: the one matrix entry (\"M2 row 1 col 3\") or word (\"T3 word 5\") that is wrong, "
    + `not the whole matrix or line. At most ${MAX_ANNOTATIONS_PER_TURN} annotations per reply, so mark what matters most — in worked steps, the first mistake, `
    + "since every step after it carries it — and say the rest in your reply.",
  "You can't change or erase anything on the board, your own annotations included. Your earlier annotations are in the board text, labelled K: "
    + "don't mark the same thing again.",
].join("\n\n");

/**
 * The model's whole output for one reply, thinking included. On a clean board
 * read, thinking is short and helps a little; on a garbled one it runs away,
 * fills the provider's default 8192 tokens, and only then does OllamaProvider
 * silently retry with thinking off. Capping it here makes that fallback come
 * after about 40 s instead of about 2 minutes. The cap also bounds the
 * visible answer (the retry gets the same budget), which is plenty for a
 * question about the board.
 */
const MAX_OUTPUT_TOKENS = 3072;

const rectSchema = z.object({
  minX: z.number().finite(), minY: z.number().finite(), maxX: z.number().finite(), maxY: z.number().finite(),
}).refine((r) => r.minX <= r.maxX && r.minY <= r.maxY, "empty rectangle");

const requestSchema = z.object({
  message: z.string().trim().min(1),
  selection: z.object({ rect: rectSchema }).optional(),
});

/** Created on first use, with the model and thinking setting a new chat would get (app/api/chat/route.ts). */
async function createCanvasChat(canvasId: string, title: string, userId: string) {
  const [user] = await db.select({ defaultModel: users.defaultModel, defaultThinkingEnabled: users.defaultThinkingEnabled })
    .from(users).where(eq(users.id, userId)).limit(1);
  const [chat] = await db.insert(chats).values({
    userId,
    canvasId,
    title,
    model: CHAT_MODELS.some((m) => m.id === user!.defaultModel) ? user!.defaultModel : DEFAULT_CHAT_MODEL,
    thinkingEnabled: user!.defaultThinkingEnabled,
  }).returning();
  return chat!;
}

/** What the model reads for one of the student's messages: what changed on the board since their last one, the board as text, then what they wrote. */
function forModel(context: CanvasContext | null, message: string): string {
  return context
    ? [...(context.changes ? [context.changes] : []), context.text, `THE STUDENT'S MESSAGE\n${message}`].join("\n\n")
    : message;
}

/** The conversation so far; `chatId` is null until the first message creates it. */
export async function GET(_req: Request, { params }: { params: Promise<{ canvasId: string }> }) {
  try {
    const { canvasId } = await params;
    const session = await requireSession();
    await requireOwnCanvas(canvasId, session);

    const chat = await findCanvasChat(canvasId, session.userId);
    const rows = chat
      ? await db.select().from(messages).where(eq(messages.chatId, chat.id)).orderBy(asc(messages.createdAt))
      : [];
    return Response.json({ chatId: chat?.id ?? null, messages: rows.map(toClientMessage) });
  } catch (err) {
    return authzResponse(err) ?? Response.json({ error: "internal" }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ canvasId: string }> }) {
  try {
    const { canvasId } = await params;
    const session = await requireSession();
    // §9 — the ownership check happens before any work.
    const canvas = await requireOwnCanvas(canvasId, session);

    const parsed = requestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "bad request" }, { status: 400 });
    const { message } = parsed.data;
    const region = parsed.data.selection?.rect ?? null;

    const chatId = ((await findCanvasChat(canvasId, session.userId)) ?? (await createCanvasChat(canvasId, canvas.title, session.userId))).id;

    // All under the chat's lock, so no entry can land between the ones this message folds in and the message itself.
    const { chat, context, history, edits, userRow, assistantRow, board } = await db.transaction(async (tx) => {
      const chat = await lockChat(tx, chatId);
      const [current] = await tx.select({ payload: artifacts.payload, version: artifacts.version }).from(artifacts).where(eq(artifacts.id, canvasId));
      // The log catches up with the board as saved; that read is the one to send, unless only a region is wanted.
      const synced = await syncEditLog(tx, chat, current!);
      const { elements } = canvasPayloadSchema.parse(current!.payload);
      const read = synced.read && !region ? synced.read : readCanvas(elements, {
        labels: synced.read?.labels ?? (chat.canvasLabels as LabelMap | null) ?? undefined,
        ...(region ? { region } : {}),
      });

      const history = await tx.select().from(messages).where(eq(messages.chatId, chatId)).orderBy(asc(messages.createdAt));
      let since = history.length;
      while (since > 0 && history[since - 1]!.role !== "user") since--;
      const entries = history.slice(since).filter((m) => m.role === "event").map((m) => m.event as CanvasEdit);
      const context: CanvasContext = { text: read.text, region, ...(entries.length > 0 ? { changes: changesSection(entries) } : {}) };

      await tx.update(chats).set({ canvasLabels: read.labels, updatedAt: new Date() }).where(eq(chats.id, chatId));
      const [userRow] = await tx.insert(messages).values({
        userId: session.userId, chatId, role: "user", content: message, canvasContext: context, createdAt: sql`clock_timestamp()`,
      }).returning();
      const [assistantRow] = await tx.insert(messages).values({
        userId: session.userId, chatId, role: "assistant", content: "", status: "streaming", createdAt: sql`clock_timestamp()`,
      }).returning();
      // What annotations are placed by: the whole board, read with the same labels — the read just made, unless that was of a region.
      const whole = region ? synced.read : read;
      const board = () => ({ elements, doc: (whole ?? readCanvas(elements, { labels: read.labels })).doc });
      return { chat, context, history, edits: synced.written, userRow: userRow!, assistantRow: assistantRow!, board };
    });

    const modelMessages: Message[] = [
      ...history.flatMap((m): Message[] => {
        if (m.role === "user") return [{ role: "user", content: forModel(m.canvasContext as CanvasContext | null, m.content) }];
        if (m.role === "assistant" && m.content) return [{ role: "assistant", content: m.content }];
        return [];
      }),
      { role: "user", content: forModel(context, message) },
    ];
    const messageId = assistantRow.id;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enc = new TextEncoder();
        // A client that has gone away must not end the turn — it still runs to completion and is stored.
        const send = (ev: CanvasChatEvent) => {
          try { controller.enqueue(enc.encode(encodeCanvasChatEvent(ev))); } catch { /* no one listening */ }
        };
        let text = "";
        let error: string | null = null;
        try {
          send({ type: "canvas_context", userMessageId: userRow.id, messageId, edits: edits.map(toClientMessage), ...context });
          const provider = scriptedProvider(chat.model) ?? getChatProvider(session.userId, { model: chat.model, think: chat.thinkingEnabled === 1 });
          error = await runCanvasTurn({
            provider, system: SYSTEM, messages: modelMessages, maxTokens: MAX_OUTPUT_TOKENS, board,
            send: (ev) => {
              if (ev.type === "text_delta") text += ev.text;
              send(ev);
            },
          });
        } catch (err) {
          console.error(`canvas chat ${chatId} failed mid-turn:`, err);
          error = err instanceof Error ? err.message : String(err);
        }
        try {
          await db.update(messages)
            .set({ content: text, status: error ? "error" : "done", errorMessage: error })
            .where(eq(messages.id, messageId));
        } catch (err) {
          console.error(`canvas chat ${chatId}: couldn't store the reply:`, err);
        }
        send(error ? { type: "error", message: error } : { type: "message_end", messageId });
        try { controller.close(); } catch { /* already closed by a disconnect */ }
      },
    });

    return new Response(stream, {
      // The charset matters: the reader's text is full of "—" and "×", and a client going by the header would mangle them.
      headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive" },
    });
  } catch (err) {
    return authzResponse(err) ?? Response.json({ error: "internal" }, { status: 500 });
  }
}
