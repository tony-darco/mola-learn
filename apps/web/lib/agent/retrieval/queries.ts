/**
 * The three retrieval primitives behind §6's ReAct agent, kept as plain
 * functions (not Tool objects) so they're directly testable and reusable by
 * both the tool wrappers in lib/agent/tools/ and the golden-set harness.
 *
 * Design input (evals/golden/RESULTS.md, measured on a real syllabus):
 * vector and BM25 fail in OPPOSITE directions — BM25 wins on exact tokens
 * ("SafeAssign") and collapses on paraphrase; vector is the inverse. Neither
 * alone cleared 20/20 at @5. That's why the agent gets both, plus grep for the
 * literal-substring case neither ranking function is built for. All misses in
 * the baseline landed at rank 6–7, so top-k defaults to 10, not 5.
 */
import { and, desc, eq, ilike, inArray, isNotNull, sql } from "drizzle-orm";
import { db, documentChunks, documents } from "@mola/db";
import type { EmbeddingProvider } from "../../llm/types";
import { notReadyDocs, readyIds, scopedDocuments } from "./status";

const DEFAULT_LIMIT = 10;

export type ChunkHit = {
  documentId: string;
  documentTitle: string;
  ordinal: number;
  text: string;
  locator: string | null;
};

export type SearchScope = { userId: string; courseId: string | null; limit?: number };

/** Tool 1 — grep-style literal substring search, backed by chunks_trgm_idx. */
export async function grepSearch(pattern: string, scope: SearchScope): Promise<ChunkHit[]> {
  const { userId, courseId, limit = DEFAULT_LIMIT } = scope;
  const courseFilter = courseId ? eq(documents.courseId, courseId) : undefined;

  const rows = await db
    .select({
      documentId: documentChunks.documentId,
      documentTitle: documents.title,
      ordinal: documentChunks.ordinal,
      text: documentChunks.text,
      locator: documentChunks.locator,
    })
    .from(documentChunks)
    .innerJoin(documents, eq(documents.id, documentChunks.documentId))
    .where(and(eq(documentChunks.userId, userId), courseFilter, ilike(documentChunks.text, `%${pattern}%`)))
    .orderBy(desc(sql`similarity(${documentChunks.text}, ${pattern})`))
    .limit(limit);

  return rows;
}

/** Tool 2 — BM25-style keyword relevance via Postgres full-text search (ts_rank_cd). */
export async function bm25Search(query: string, scope: SearchScope): Promise<ChunkHit[]> {
  const { userId, courseId, limit = DEFAULT_LIMIT } = scope;
  const courseFilter = courseId ? eq(documents.courseId, courseId) : undefined;
  const tsq = sql`plainto_tsquery('english', ${query})`;
  const rank = sql`ts_rank_cd(to_tsvector('english', ${documentChunks.text}), ${tsq})`;

  const rows = await db
    .select({
      documentId: documentChunks.documentId,
      documentTitle: documents.title,
      ordinal: documentChunks.ordinal,
      text: documentChunks.text,
      locator: documentChunks.locator,
    })
    .from(documentChunks)
    .innerJoin(documents, eq(documents.id, documentChunks.documentId))
    .where(
      and(
        eq(documentChunks.userId, userId),
        courseFilter,
        sql`to_tsvector('english', ${documentChunks.text}) @@ ${tsq}`,
      ),
    )
    .orderBy(desc(rank))
    .limit(limit);

  return rows;
}

export type VectorSearchResult =
  | { indexed: true; hits: ChunkHit[]; pending: ReturnType<typeof notReadyDocs> }
  | { indexed: false; pending: ReturnType<typeof notReadyDocs> };

/**
 * Tool 3 — vector similarity, HNSW/cosine. Only ever looks at chunks whose
 * parent document is `ready` (§6) — never guesses on a partially-indexed doc.
 *
 * CRITICAL (contract 3): this is the query side of the embedding asymmetry —
 * `embedder.embed([query], "query")` applies the Instruct/Query prefix. The
 * caller must pass the platform SelfHostedEmbeddingProvider; a BYOK key must
 * never reach this function.
 */
export async function vectorSearch(
  query: string,
  scope: SearchScope,
  embedder: EmbeddingProvider,
): Promise<VectorSearchResult> {
  const { userId, courseId, limit = DEFAULT_LIMIT } = scope;
  const docs = await scopedDocuments(userId, courseId);
  const ready = readyIds(docs);
  const pending = notReadyDocs(docs);

  if (ready.length === 0) {
    return { indexed: false, pending };
  }

  const [vec] = await embedder.embed([query], "query");
  const vecLiteral = `[${vec!.join(",")}]`;
  const distance = sql`${documentChunks.embedding} <=> ${vecLiteral}::vector`;

  const rows = await db
    .select({
      documentId: documentChunks.documentId,
      documentTitle: documents.title,
      ordinal: documentChunks.ordinal,
      text: documentChunks.text,
      locator: documentChunks.locator,
    })
    .from(documentChunks)
    .innerJoin(documents, eq(documents.id, documentChunks.documentId))
    .where(
      and(
        eq(documentChunks.userId, userId),
        inArray(documentChunks.documentId, ready),
        isNotNull(documentChunks.embedding),
      ),
    )
    .orderBy(distance)
    .limit(limit);

  return { indexed: true, hits: rows, pending };
}
