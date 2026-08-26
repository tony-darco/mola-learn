/**
 * The chat endpoint. Walks every Phase 0 contract in order:
 *
 *   requireOwned (2) → assembleContext (5) → buildRegistry (4)
 *     → runAgentLoop (4) → OllamaProvider (3) → SSE taxonomy (6)
 *
 * Extended for the Phase 1 chat surface: persists the tool/sub-agent activity
 * log alongside each assistant message so a reload can re-render collapsed
 * rows without replaying the stream, wires artifact persistence into the
 * frozen loop's `persistArtifact` hook (contract 4 — the loop calls this, it
 * never writes to the artifacts table itself), and runs compaction (§4) after
 * each turn.
 */
import { and, asc, desc, eq } from "drizzle-orm";
import {
  artifactRecordSchema, encodeSSE, isArtifactToolResult, type StreamEvent,
} from "@mola/shared";
import { artifacts, chats, compactionBoundaries, courses, db, messages } from "@mola/db";
import { authzResponse, requireOwned, requireSession } from "@/lib/auth/ownership";
import { assembleContext } from "@/lib/context/assemble";
import { canEscalate, escalate } from "@/lib/context/hint-ladder";
import { buildRegistry } from "@/lib/agent/tools";
import { runAgentLoop, type ToolContext } from "@/lib/agent";
import { maybeCompact } from "@/lib/agent/compaction";
import { getChatProvider } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What gets persisted to `messages.toolCalls` — enough to re-render on reload. */
type ActivityEntry =
  | { kind: "tool"; id: string; name: string; label: string; status: "ok" | "error"; summary: string }
  | { kind: "subagent"; id: string; label: string; status: "done" };

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
        const activity: ActivityEntry[] = [];
        const toolCallMeta = new Map<string, { name: string; label: string }>();
        const ctx: ToolContext = { session, chatId, courseId: chat.courseId, signal: req.signal };

        try {
          send({ type: "message_start", messageId: assistantRow!.id });
          if (rung) send({ type: "hint_state", rung, canEscalate: canEscalate(rung) });

          for await (const ev of runAgentLoop({
            provider: getChatProvider(session.userId),
            system: context.system,
            messages: [...context.messages, { role: "user", content: userText }],
            tools: registry,
            ctx,
            persistArtifact: (result) => persistArtifact(result, ctx),
          })) {
            if (ev.type === "text_delta") text += ev.text;
            if (ev.type === "message_end") continue;

            if (ev.type === "tool_call_start") toolCallMeta.set(ev.toolCallId, { name: ev.name, label: ev.label });
            if (ev.type === "tool_call_end") {
              const meta = toolCallMeta.get(ev.toolCallId);
              activity.push({
                kind: "tool", id: ev.toolCallId, name: meta?.name ?? "unknown",
                label: meta?.label ?? ev.toolCallId, status: ev.status, summary: ev.summary,
              });
            }
            // Sub-agent runs never reach the client with visible internals (§4) —
            // only start/end land here, and only the end carries enough to log.
            if (ev.type === "subagent_end") {
              activity.push({ kind: "subagent", id: ev.subagentId, label: "sub-agent", status: "done" });
            }

            send(ev);
          }

          await db.update(messages)
            .set({ content: text, toolCalls: activity })
            .where(eq(messages.id, assistantRow!.id));

          send({ type: "message_end", messageId: assistantRow!.id, stopReason: "end_turn" });

          const compacted = await maybeCompact(chatId, session.userId);
          if (compacted) send({ type: "compacted", throughMessageId: compacted.throughMessageId });
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

/**
 * Persists an artifact tool result and hands back the render event. This is
 * the parent-loop-persists half of contract 4: a tool/sub-agent RETURNS the
 * envelope, ownership stamping happens in exactly this one place.
 */
async function persistArtifact(result: unknown, ctx: ToolContext): Promise<StreamEvent | null> {
  if (!isArtifactToolResult(result)) return null;

  if (result.replacesArtifactId) {
    const [existing] = await db.select().from(artifacts)
      .where(eq(artifacts.id, result.replacesArtifactId)).limit(1);
    if (!existing || existing.userId !== ctx.session.userId) {
      throw new Error("cannot amend an artifact you do not own");
    }
    const [row] = await db.update(artifacts).set({
      title: result.title,
      topics: result.topics,
      sources: result.sources,
      payload: result.payload,
      version: existing.version + 1,
      updatedAt: new Date(),
    }).where(eq(artifacts.id, existing.id)).returning();
    return { type: "artifact", artifact: artifactRecordSchema.parse(row) };
  }

  const [row] = await db.insert(artifacts).values({
    userId: ctx.session.userId,
    courseId: ctx.courseId,
    originChatId: ctx.chatId,
    kind: result.kind,
    title: result.title,
    topics: result.topics,
    sources: result.sources,
    payload: result.payload,
  }).returning();

  return { type: "artifact", artifact: artifactRecordSchema.parse(row) };
}

/** GET is here so the §9 cross-user denial test has a plain endpoint to hit. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ chatId: string }> },
) {
  try {
    const { chatId } = await params;
    const chat = await requireOwned("chat", chatId);

    const [course, turns, chatArtifacts, [boundary]] = await Promise.all([
      chat.courseId
        ? db.select().from(courses).where(eq(courses.id, chat.courseId)).limit(1).then((r) => r[0] ?? null)
        : Promise.resolve(null),
      db.select().from(messages).where(eq(messages.chatId, chatId)).orderBy(asc(messages.createdAt)),
      db.select().from(artifacts).where(eq(artifacts.originChatId, chatId)).orderBy(asc(artifacts.createdAt)),
      db.select().from(compactionBoundaries).where(eq(compactionBoundaries.chatId, chatId))
        .orderBy(desc(compactionBoundaries.createdAt)).limit(1),
    ]);

    return Response.json({
      chat,
      course: course ? { id: course.id, name: course.name, number: course.number } : null,
      messages: turns,
      artifacts: chatArtifacts.map((a) => artifactRecordSchema.parse(a)),
      compactionBoundary: boundary
        ? { upToMessageId: boundary.upToMessageId, summary: boundary.summary, createdAt: boundary.createdAt }
        : null,
    });
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
