/**
 * The thin-slice chat endpoint. Walks every Phase 0 contract in order:
 *
 *   requireOwned (2) → assembleContext (5) → buildRegistry (4)
 *     → runAgentLoop (4) → OllamaProvider (3) → SSE taxonomy (6)
 */
import { and, eq } from "drizzle-orm";
import { encodeSSE, type StreamEvent } from "@mola/shared";
import { chats, db, messages } from "@mola/db";
import { authzResponse, requireOwned, requireSession } from "@/lib/auth/ownership";
import { assembleContext } from "@/lib/context/assemble";
import { canEscalate, escalate } from "@/lib/context/hint-ladder";
import { buildRegistry } from "@/lib/agent/tools";
import { runAgentLoop } from "@/lib/agent";
import { getChatProvider } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ chatId: string }> },
) {
  try {
    const { chatId } = await params;
    const session = await requireSession();

    // §9 — the ownership check happens BEFORE any work, on every request.
    const chat = await requireOwned("chat", chatId, session);

    const body = (await req.json()) as { message?: string; pullHint?: boolean };
    const userText = (body.message ?? "").trim();
    if (!userText && !body.pullHint) {
      return Response.json({ error: "empty message" }, { status: 400 });
    }

    // Hints escalate ONLY on an explicit student pull — never on a timer or an
    // attempt count (§3). This flag is the only path that advances a rung.
    const prior = await lastHintRung(chatId);
    const rung = body.pullHint ? escalate(prior) : null;

    const [userMessage] = await db.insert(messages).values({
      userId: session.userId,
      chatId,
      role: "user",
      content: userText || "(asked for a hint)",
    }).returning();

    const registry = buildRegistry();
    const context = await assembleContext({
      userId: session.userId,
      chatId,
      courseId: chat.courseId,
      tools: registry,
      hintRung: rung,
    });

    const [assistantRow] = await db.insert(messages).values({
      userId: session.userId,
      chatId,
      role: "assistant",
      content: "",
      hintRung: rung,
    }).returning();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enc = new TextEncoder();
        const send = (ev: StreamEvent) => controller.enqueue(enc.encode(encodeSSE(ev)));
        let text = "";

        try {
          send({ type: "message_start", messageId: assistantRow!.id });
          if (rung) send({ type: "hint_state", rung, canEscalate: canEscalate(rung) });

          for await (const ev of runAgentLoop({
            provider: getChatProvider(session.userId),
            system: context.system,
            messages: [...context.messages, { role: "user", content: userText }],
            tools: registry,
            ctx: { session, chatId, courseId: chat.courseId, signal: req.signal },
          })) {
            if (ev.type === "text_delta") text += ev.text;
            if (ev.type === "message_end") continue;
            send(ev);
          }

          await db.update(messages)
            .set({ content: text })
            .where(eq(messages.id, assistantRow!.id));

          send({ type: "message_end", messageId: assistantRow!.id, stopReason: "end_turn" });
        } catch (err) {
          send({ type: "error", message: err instanceof Error ? err.message : String(err) });
        } finally {
          controller.close();
        }
      },
    });

    void userMessage;
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

/** GET is here so the §9 cross-user denial test has a plain endpoint to hit. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ chatId: string }> },
) {
  try {
    const { chatId } = await params;
    const chat = await requireOwned("chat", chatId);
    const turns = await db.select().from(messages).where(eq(messages.chatId, chatId));
    return Response.json({ chat, messages: turns });
  } catch (err) {
    return authzResponse(err) ?? Response.json({ error: "internal" }, { status: 500 });
  }
}

async function lastHintRung(chatId: string) {
  const rows = await db
    .select({ hintRung: messages.hintRung })
    .from(messages)
    .where(and(eq(messages.chatId, chatId), eq(messages.role, "assistant")));
  const withRung = rows.filter((r) => r.hintRung);
  return (withRung.at(-1)?.hintRung ?? null) as null | "pointing" | "teaching" | "bottom_out";
}

void chats;
