/**
 * GET: reconnects to an in-progress (or just-finished) turn.
 *
 * The client opens exactly one of these per turn it needs to know about, on
 * finding a "streaming" message in loaded history (ChatMain's hydrate) —
 * never on an interval. If the message already reached a terminal status,
 * this resolves immediately with that outcome. Otherwise the connection
 * stays open and the server pushes to it the moment there IS a terminal
 * outcome, via Postgres LISTEN/NOTIFY (packages/db/src/notify.ts) keyed on
 * this message id — the generating request NOTIFYs the same channel the
 * instant it writes "done" or "error" (see /api/chat/[chatId]/route.ts).
 * Zero additional client-visible requests either way.
 *
 * Deliberately does not replay text token-by-token: NOTIFY is a signal, not
 * a data channel, and the only two states the reconnecting client actually
 * needs are "still going" (already covered by the loaded history showing
 * status "streaming" — this stream just tells it when that stops being
 * true) and "here's how it ended".
 */
import { eq } from "drizzle-orm";
import { encodeSSE, type StreamEvent } from "@mola/shared";
import { db, listenForMessageDone, messages } from "@mola/db";
import { authzResponse, requireOwned } from "@/lib/auth/ownership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadMessage(messageId: string) {
  const [row] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  return row ?? null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ chatId: string; messageId: string }> },
) {
  try {
    const { chatId, messageId } = await params;
    await requireOwned("chat", chatId);
    const message = await requireOwned("message", messageId);

    if (message.chatId !== chatId) {
      return Response.json({ error: "message does not belong to this chat" }, { status: 400 });
    }

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enc = new TextEncoder();
        const send = (ev: StreamEvent) => {
          try {
            controller.enqueue(enc.encode(encodeSSE(ev)));
          } catch {
            // The reconnecting client disconnected again before the terminal
            // event landed — nothing to do; there's no one to receive it.
          }
        };
        let closed = false;

        const emitTerminal = (row: NonNullable<Awaited<ReturnType<typeof loadMessage>>>) => {
          if (row.status === "error") {
            send({ type: "error", message: row.errorMessage ?? "generation failed" });
          } else {
            // "done" (or, in the pathological case of a row that somehow
            // never left "streaming" some other way — treated the same as
            // done, since content is whatever was last persisted).
            send({ type: "text_delta", text: row.content });
            send({ type: "message_end", messageId: row.id, stopReason: "end_turn" });
          }
        };

        let resolveDone: (() => void) | null = null;
        const done = new Promise<void>((resolve) => { resolveDone = resolve; });

        // Registered and confirmed active BEFORE the first status read below —
        // a completion that lands in between must never be missed for want
        // of a client-side poll to catch it later.
        const unlisten = await listenForMessageDone(messageId, () => resolveDone?.());

        try {
          const initial = await loadMessage(messageId);
          if (!initial) return; // deleted (e.g. a retry) out from under us
          if (initial.status !== "streaming") {
            emitTerminal(initial);
            return;
          }

          await done;
          const final = await loadMessage(messageId);
          if (final) emitTerminal(final);
        } finally {
          await unlisten();
          if (!closed) {
            closed = true;
            try {
              controller.close();
            } catch {
              // Already closed by a client disconnect — nothing to do.
            }
          }
        }
      },
      cancel() {
        // The client navigated away or closed the tab — nothing to clean up
        // beyond the listener above's own finally block, which still runs.
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      },
    });
  } catch (err) {
    return authzResponse(err) ?? Response.json({ error: "internal" }, { status: 500 });
  }
}
