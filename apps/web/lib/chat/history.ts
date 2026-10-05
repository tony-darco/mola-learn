import { asc, desc, eq } from "drizzle-orm";
import { artifactRecordSchema } from "@mola/shared";
import { artifacts, chats, compactionBoundaries, courses, db, messages } from "@mola/db";
import { getPublicApiKey } from "@/lib/auth/api-keys";

/**
 * Everything a chat pane needs to render, for an already-ownership-checked
 * chat row. Shared by `GET /api/chat/[chatId]` (client refetches) and the
 * `/chats/[chatId]` server component (first paint, so opening a chat doesn't
 * wait on a second client-side round-trip behind "Loading conversation…").
 */
export async function loadChatHistory(chat: typeof chats.$inferSelect) {
  const [course, turns, chatArtifacts, [boundary], ownKey] = await Promise.all([
    chat.courseId
      ? db.select().from(courses).where(eq(courses.id, chat.courseId)).limit(1).then((r) => r[0] ?? null)
      : Promise.resolve(null),
    db.select().from(messages).where(eq(messages.chatId, chat.id)).orderBy(asc(messages.createdAt)),
    db.select().from(artifacts).where(eq(artifacts.originChatId, chat.id)).orderBy(asc(artifacts.createdAt)),
    db.select().from(compactionBoundaries).where(eq(compactionBoundaries.chatId, chat.id))
      .orderBy(desc(compactionBoundaries.createdAt)).limit(1),
    getPublicApiKey(chat.userId),
  ]);

  return {
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
  };
}
