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
import {
  artifacts, cardSrsState, chats, compactionBoundaries, courses, db, flashcards, messages, users,
} from "@mola/db";
import { authzResponse, requireOwned, requireSession } from "@/lib/auth/ownership";
import { getPublicApiKey } from "@/lib/auth/api-keys";
import { assembleContext } from "@/lib/context/assemble";
import { canEscalate, escalate } from "@/lib/context/hint-ladder";
import { buildRegistry } from "@/lib/agent/tools";
import { runAgentLoop, type ToolContext } from "@/lib/agent";
import { maybeCompact, makeLlmSummarizer } from "@/lib/agent/compaction";
import { getChatProvider, CHAT_MODELS } from "@/lib/llm";
import { generateChatTitle } from "@/lib/llm/title";
import { logChatTurn } from "@/lib/debug/chat-log";

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

    void logChatTurn({
      direction: "input", chatId, userId: session.userId, userEmail: session.email,
      model: chat.model, pullHint: body.pullHint, text: userText || "(asked for a hint)",
    });

    // A turn's own activity must bump the parent chat's updatedAt — the
    // sidebar sorts by desc(chats.updatedAt) (app/api/chat/route.ts), and
    // without this a chat you're actively talking in never rises above one
    // merely created earlier and never opened again.
    await db.update(chats)
      .set({ updatedAt: new Date() })
      .where(eq(chats.id, chatId));

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
        let errorMessage: string | null = null;
        const activity: ActivityEntry[] = [];
        const toolCallMeta = new Map<string, { name: string; label: string }>();
        const think = chat.thinkingEnabled === 1;
        const ctx: ToolContext = {
          session, chatId, courseId: chat.courseId, signal: req.signal,
          model: chat.model, think,
        };

        try {
          send({ type: "message_start", messageId: assistantRow!.id });
          if (rung) send({ type: "hint_state", rung, canEscalate: canEscalate(rung) });

          let loopErrored = false;

          for await (const ev of runAgentLoop({
            provider: getChatProvider(session.userId, { model: chat.model, think }),
            system: context.system,
            messages: [...context.messages, { role: "user", content: userText }],
            tools: registry,
            ctx,
            // loop.ts's own default (8) is too low for a weaker tool-caller
            // (e.g. gemma4:12b) that needs a few extra tries on the same
            // search before it gives up — overridden here rather than in
            // loop.ts itself, which is frozen (contract 4).
            maxIterations: Number(process.env.MOLA_AGENT_MAX_ITERATIONS ?? 16),
            persistArtifact: (result) => persistArtifact(result, ctx),
          })) {
            if (ev.type === "text_delta") text += ev.text;
            if (ev.type === "message_end") continue;
            if (ev.type === "error") { loopErrored = true; errorMessage = ev.message; }

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

          // An "error" event already ended the turn client-side (case "error"
          // in ChatMain sets streaming: false) — a trailing success message_end
          // plus a compaction pass over a chat that just failed would be
          // spurious work layered on top of an already-reported failure.
          if (!loopErrored) {
            send({ type: "message_end", messageId: assistantRow!.id, stopReason: "end_turn" });

            // Auto-titles once, right after the first exchange — "New chat"
            // is the creation default and nothing else ever sets it back to
            // that literal string, so it doubles as "not yet titled" without
            // needing a new schema column. Always the small fast model
            // (never whatever the student picked for the chat itself) and
            // awaited here — by the time the client's post-stream
            // refreshSidebar() call fires, the new title is already in the
            // DB for it to pick up, not applied later in the background.
            if (chat.title === "New chat" && text.trim()) {
              const generatedTitle = await generateChatTitle(userText, text);
              if (generatedTitle) {
                await db.update(chats).set({ title: generatedTitle }).where(eq(chats.id, chatId));
              }
            }

            const compacted = await maybeCompact(
              chatId, session.userId, makeLlmSummarizer(session.userId, { model: chat.model, think }),
            );
            if (compacted) send({ type: "compacted", throughMessageId: compacted.throughMessageId });
          }
        } catch (err) {
          console.error(`chat ${chatId} stream failed mid-turn:`, err);
          // A mid-stream failure (e.g. the LAN Ollama host dropping a long-lived
          // connection) must not leave the row silently empty: the browser may
          // already have rendered most of the answer via SSE deltas before the
          // throw, and a reload should show that partial progress rather than a
          // blank turn. Best-effort — a failure here must not mask the real error.
          try {
            await db.update(messages)
              .set({ content: text, toolCalls: activity })
              .where(eq(messages.id, assistantRow!.id));
          } catch {
            // Nothing more we can do; the error event below still reaches the client.
          }
          errorMessage = err instanceof Error ? err.message : String(err);
          send({ type: "error", message: errorMessage });
        } finally {
          void logChatTurn({
            direction: "output", chatId, userId: session.userId, userEmail: session.email,
            model: chat.model, text, error: errorMessage,
          });
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
    if (result.payload.kind === "flashcard_deck") {
      await syncFlashcardDeck(row!.id, ctx, result.payload.cards);
    }
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

  if (result.payload.kind === "flashcard_deck") {
    await syncFlashcardDeck(row!.id, ctx, result.payload.cards);
  }

  return { type: "artifact", artifact: artifactRecordSchema.parse(row) };
}

/**
 * Denormalizes a flashcard_deck artifact's payload into `flashcards` +
 * `card_srs_state` (§6: "denormalised out of the deck payload so SRS can
 * query due cards directly" — schema.ts comment on cardSrsState). Every card
 * keeps the same id in both the JSON payload and its `flashcards` row, so no
 * id-mapping table is needed.
 *
 * An amendment fully replaces the card set — cascading deletes clear the old
 * `card_srs_state` rows along with the old `flashcards` rows, so SRS progress
 * resets on amendment rather than trying to diff/preserve it card-by-card.
 * Not specified either way by the design doc; this is the simpler, honest
 * default until real usage says otherwise.
 */
async function syncFlashcardDeck(
  deckId: string,
  ctx: ToolContext,
  cards: { id: string; front: string; back: string; chapter: string | null; section: string | null; week: number | null }[],
): Promise<void> {
  await db.delete(flashcards).where(eq(flashcards.deckId, deckId));
  if (cards.length === 0) return;

  await db.insert(flashcards).values(cards.map((c) => ({
    id: c.id,
    userId: ctx.session.userId,
    deckId,
    courseId: ctx.courseId,
    front: c.front,
    back: c.back,
    chapter: c.chapter,
    section: c.section,
    week: c.week,
  })));

  await db.insert(cardSrsState).values(cards.map((c) => ({
    userId: ctx.session.userId,
    cardId: c.id,
  })));
}

/** PATCH: Update chat metadata (title, courseId, isPinned) */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ chatId: string }> },
) {
  try {
    const { chatId } = await params;
    const session = await requireSession();

    // §9 — ownership check
    const chat = await requireOwned("chat", chatId, session);

    const body = (await req.json().catch(() => ({}))) as {
      title?: string;
      courseId?: string | null;
      isPinned?: boolean;
      model?: string;
      thinkingEnabled?: boolean;
    };

    // Validate course ownership if provided
    if (body.courseId) {
      const [course] = await db.select().from(courses)
        .where(eq(courses.id, body.courseId)).limit(1);
      if (!course || course.userId !== session.userId) {
        return Response.json({ error: "course not found" }, { status: 404 });
      }
    }

    const updateData: Partial<typeof chat> = {};
    if (body.title !== undefined) updateData.title = body.title.trim() || "Untitled";
    if (body.courseId !== undefined) updateData.courseId = body.courseId;
    if (body.isPinned !== undefined) updateData.isPinned = body.isPinned ? 1 : 0;

    // Switching model/thinking on this chat also becomes the default the
    // *next* new chat starts with — other existing chats are untouched.
    //
    // Stored thinkingEnabled is the user's raw preference, NOT clamped against
    // the model here — switching to rnj-1 and back to a thinking-capable model
    // must not leave it stuck off. modelSupportsThinking() is what actually
    // keeps Ollama from erroring (ollamaProviderFor, lib/llm/index.ts); this
    // just persists what was asked for.
    if (body.model !== undefined || body.thinkingEnabled !== undefined) {
      const targetModel = body.model ?? chat.model;
      if (body.model !== undefined && !CHAT_MODELS.some((m) => m.id === targetModel)) {
        return Response.json({ error: "unknown model" }, { status: 400 });
      }
      const thinkingEnabled = body.thinkingEnabled ?? chat.thinkingEnabled === 1;

      updateData.model = targetModel;
      updateData.thinkingEnabled = thinkingEnabled ? 1 : 0;

      // Both writes committed together — a partial failure must not leave the
      // account-wide default changed with no matching effect on the chat that
      // triggered it (or vice versa).
      const [updated] = await db.transaction(async (tx) => {
        await tx.update(users).set({
          defaultModel: targetModel,
          defaultThinkingEnabled: thinkingEnabled ? 1 : 0,
        }).where(eq(users.id, session.userId));

        return tx.update(chats).set(updateData).where(eq(chats.id, chatId)).returning();
      });

      return Response.json({
        id: updated!.id,
        title: updated!.title,
        courseId: updated!.courseId,
        isPinned: updated!.isPinned,
        model: updated!.model,
        thinkingEnabled: updated!.thinkingEnabled === 1,
      });
    }

    const [updated] = await db.update(chats)
      .set(updateData)
      .where(eq(chats.id, chatId))
      .returning();

    return Response.json({
      id: updated!.id,
      title: updated!.title,
      courseId: updated!.courseId,
      isPinned: updated!.isPinned,
      model: updated!.model,
      thinkingEnabled: updated!.thinkingEnabled === 1,
    });
  } catch (err) {
    return authzResponse(err) ?? Response.json({ error: "internal" }, { status: 500 });
  }
}

/** DELETE: Delete a chat */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ chatId: string }> },
) {
  try {
    const { chatId } = await params;
    const session = await requireSession();

    // §9 — ownership check
    await requireOwned("chat", chatId, session);

    // Delete will cascade to messages and other related records
    await db.delete(chats).where(eq(chats.id, chatId));

    return Response.json({ success: true });
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

    const [course, turns, chatArtifacts, [boundary], ownKey] = await Promise.all([
      chat.courseId
        ? db.select().from(courses).where(eq(courses.id, chat.courseId)).limit(1).then((r) => r[0] ?? null)
        : Promise.resolve(null),
      db.select().from(messages).where(eq(messages.chatId, chatId)).orderBy(asc(messages.createdAt)),
      db.select().from(artifacts).where(eq(artifacts.originChatId, chatId)).orderBy(asc(artifacts.createdAt)),
      db.select().from(compactionBoundaries).where(eq(compactionBoundaries.chatId, chatId))
        .orderBy(desc(compactionBoundaries.createdAt)).limit(1),
      getPublicApiKey(chat.userId),
    ]);

    return Response.json({
      chat,
      course: course ? { id: course.id, name: course.name, number: course.number } : null,
      messages: turns,
      artifacts: chatArtifacts.map((a) => artifactRecordSchema.parse(a)),
      compactionBoundary: boundary
        ? { upToMessageId: boundary.upToMessageId, summary: boundary.summary, createdAt: boundary.createdAt }
        : null,
      // A BYOK user's model/thinking picker has no effect (resolveProvider
      // never forwards it to OpenAI/Anthropic) — the client uses this to hide
      // the picker rather than show one that silently does nothing.
      hasOwnKey: ownKey !== null,
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
