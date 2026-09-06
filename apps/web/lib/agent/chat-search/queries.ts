/**
 * The two chat-search primitives behind §6's "Chat search agent (grep +
 * BM25 only)" — kept as plain functions (not Tool objects), mirroring
 * lib/agent/retrieval/queries.ts, so they're directly testable.
 *
 * Deliberately no vector_search here (§6): chat recall is a literal lookup
 * problem ("what did we work out about eigenvectors"), not a paraphrase
 * problem, so keyword/substring matching is the right instrument and a
 * continuously re-embedded chat corpus is not worth the cost.
 *
 * Searches BOTH layers — raw message turns (messages_fts_idx /
 * messages_trgm_idx) and compaction summaries (compaction_fts_idx). A
 * compacted session still has its raw transcript underneath (never deleted,
 * see compactionBoundaries), so every summary hit carries `upToMessageId`
 * pointing back into the raw turns it was condensed from.
 */
import { and, desc, eq, ilike, sql } from "drizzle-orm";
import { chats, compactionBoundaries, db, messages } from "@mola/db";

const DEFAULT_LIMIT = 10;

export type ChatHit = {
  source: "message" | "summary";
  chatId: string;
  chatTitle: string;
  /** The raw message to jump to — the turn itself for a message hit, or the
   * boundary's upToMessageId (last raw turn it condensed) for a summary hit. */
  messageId: string;
  /** null for a summary hit — a compaction summary has no single role. */
  role: string | null;
  text: string;
  createdAt: Date;
};

export type ChatSearchScope = { userId: string; limit?: number };

/** Round-robins two already-ranked lists so neither layer is starved by the other, then caps at `limit`. */
function interleave<T>(a: T[], b: T[], limit: number): T[] {
  const out: T[] = [];
  for (let i = 0; i < Math.max(a.length, b.length) && out.length < limit; i++) {
    if (i < a.length) out.push(a[i]!);
    if (i < b.length && out.length < limit) out.push(b[i]!);
  }
  return out;
}

/** Tool 1 — grep-style literal substring search, backed by messages_trgm_idx / compaction summaries. */
export async function grepChats(pattern: string, scope: ChatSearchScope): Promise<ChatHit[]> {
  const { userId, limit = DEFAULT_LIMIT } = scope;

  const messageRows = await db
    .select({
      chatId: messages.chatId,
      chatTitle: chats.title,
      messageId: messages.id,
      role: messages.role,
      text: messages.content,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .innerJoin(chats, eq(chats.id, messages.chatId))
    .where(and(eq(messages.userId, userId), ilike(messages.content, `%${pattern}%`)))
    .orderBy(desc(sql`similarity(${messages.content}, ${pattern})`))
    .limit(limit);

  const summaryRows = await db
    .select({
      chatId: compactionBoundaries.chatId,
      chatTitle: chats.title,
      messageId: compactionBoundaries.upToMessageId,
      role: sql<string | null>`null`,
      text: compactionBoundaries.summary,
      createdAt: compactionBoundaries.createdAt,
    })
    .from(compactionBoundaries)
    .innerJoin(chats, eq(chats.id, compactionBoundaries.chatId))
    .where(and(eq(compactionBoundaries.userId, userId), ilike(compactionBoundaries.summary, `%${pattern}%`)))
    .orderBy(desc(sql`similarity(${compactionBoundaries.summary}, ${pattern})`))
    .limit(limit);

  const messageHits: ChatHit[] = messageRows.map((r) => ({ ...r, source: "message" }));
  const summaryHits: ChatHit[] = summaryRows.map((r) => ({ ...r, source: "summary" }));
  return interleave(messageHits, summaryHits, limit);
}

/** Tool 2 — BM25-style keyword relevance via Postgres full-text search (ts_rank_cd). */
export async function bm25Chats(query: string, scope: ChatSearchScope): Promise<ChatHit[]> {
  const { userId, limit = DEFAULT_LIMIT } = scope;
  const tsq = sql`plainto_tsquery('english', ${query})`;

  const messageRank = sql`ts_rank_cd(to_tsvector('english', ${messages.content}), ${tsq})`;
  const messageRows = await db
    .select({
      chatId: messages.chatId,
      chatTitle: chats.title,
      messageId: messages.id,
      role: messages.role,
      text: messages.content,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .innerJoin(chats, eq(chats.id, messages.chatId))
    .where(and(eq(messages.userId, userId), sql`to_tsvector('english', ${messages.content}) @@ ${tsq}`))
    .orderBy(desc(messageRank))
    .limit(limit);

  const summaryRank = sql`ts_rank_cd(to_tsvector('english', ${compactionBoundaries.summary}), ${tsq})`;
  const summaryRows = await db
    .select({
      chatId: compactionBoundaries.chatId,
      chatTitle: chats.title,
      messageId: compactionBoundaries.upToMessageId,
      role: sql<string | null>`null`,
      text: compactionBoundaries.summary,
      createdAt: compactionBoundaries.createdAt,
    })
    .from(compactionBoundaries)
    .innerJoin(chats, eq(chats.id, compactionBoundaries.chatId))
    .where(
      and(eq(compactionBoundaries.userId, userId), sql`to_tsvector('english', ${compactionBoundaries.summary}) @@ ${tsq}`),
    )
    .orderBy(desc(summaryRank))
    .limit(limit);

  const messageHits: ChatHit[] = messageRows.map((r) => ({ ...r, source: "message" }));
  const summaryHits: ChatHit[] = summaryRows.map((r) => ({ ...r, source: "summary" }));
  return interleave(messageHits, summaryHits, limit);
}
