/**
 * grep/BM25 over the textbook chapter tree (textbook_chapters/textbook_sections)
 * — the first tier of the shared strategy in tiered-search.ts. Mirrors
 * queries.ts's grepSearch/bm25Search shape exactly, but only ever returns
 * results for documents that actually have a chapter tree (kind="textbook",
 * PDF, TOC detected) — notes/syllabus/lecture_transcript naturally produce
 * no rows here, nothing to filter on their kind explicitly.
 *
 * Gated on the chapter/section row's own `status = 'ready'`, not
 * documents.status — a textbook is already documents.status='ready' via the
 * base pipeline regardless of how far the chapter-tree pass has gotten.
 */
import { and, desc, eq, ilike, sql } from "drizzle-orm";
import { db, documents, textbookChapters, textbookSections } from "@mola/db";
import type { ChunkHit, SearchScope } from "./queries";

const DEFAULT_LIMIT = 10;

/** Round-robins two already-ranked lists so neither layer starves the other — same pattern as chat-search/queries.ts. */
function interleave<T>(a: T[], b: T[], limit: number): T[] {
  const out: T[] = [];
  for (let i = 0; i < Math.max(a.length, b.length) && out.length < limit; i++) {
    if (i < a.length) out.push(a[i]!);
    if (i < b.length && out.length < limit) out.push(b[i]!);
  }
  return out;
}

function chapterLocator(chapterNumber: number | null, ordinal: number, title: string): string {
  return `ch.${chapterNumber ?? ordinal + 1} ${title}`;
}

async function grepChapters(pattern: string, scope: SearchScope): Promise<ChunkHit[]> {
  const { userId, courseId, limit = DEFAULT_LIMIT } = scope;
  const courseFilter = courseId ? eq(documents.courseId, courseId) : undefined;

  const rows = await db
    .select({
      documentId: textbookChapters.documentId,
      documentTitle: documents.title,
      ordinal: textbookChapters.ordinal,
      text: textbookChapters.markdown,
      chapterNumber: textbookChapters.chapterNumber,
      title: textbookChapters.title,
    })
    .from(textbookChapters)
    .innerJoin(documents, eq(documents.id, textbookChapters.documentId))
    .where(and(
      eq(textbookChapters.userId, userId),
      courseFilter,
      eq(textbookChapters.status, "ready"),
      ilike(textbookChapters.markdown, `%${pattern}%`),
    ))
    .orderBy(desc(sql`similarity(${textbookChapters.markdown}, ${pattern})`))
    .limit(limit);

  return rows.map((r) => ({
    documentId: r.documentId,
    documentTitle: r.documentTitle,
    ordinal: r.ordinal,
    text: r.text ?? "",
    locator: chapterLocator(r.chapterNumber, r.ordinal, r.title),
  }));
}

async function grepSections(pattern: string, scope: SearchScope): Promise<ChunkHit[]> {
  const { userId, courseId, limit = DEFAULT_LIMIT } = scope;
  const courseFilter = courseId ? eq(documents.courseId, courseId) : undefined;

  const rows = await db
    .select({
      documentId: textbookSections.documentId,
      documentTitle: documents.title,
      ordinal: textbookSections.ordinal,
      text: textbookSections.markdown,
      title: textbookSections.title,
      chapterNumber: textbookChapters.chapterNumber,
      chapterOrdinal: textbookChapters.ordinal,
      chapterTitle: textbookChapters.title,
    })
    .from(textbookSections)
    .innerJoin(documents, eq(documents.id, textbookSections.documentId))
    .innerJoin(textbookChapters, eq(textbookChapters.id, textbookSections.chapterId))
    .where(and(
      eq(textbookSections.userId, userId),
      courseFilter,
      eq(textbookSections.status, "ready"),
      ilike(textbookSections.markdown, `%${pattern}%`),
    ))
    .orderBy(desc(sql`similarity(${textbookSections.markdown}, ${pattern})`))
    .limit(limit);

  return rows.map((r) => ({
    documentId: r.documentId,
    documentTitle: r.documentTitle,
    ordinal: r.ordinal,
    text: r.text ?? "",
    locator: `${chapterLocator(r.chapterNumber, r.chapterOrdinal, r.chapterTitle)} §${r.title}`,
  }));
}

async function bm25Chapters(query: string, scope: SearchScope): Promise<ChunkHit[]> {
  const { userId, courseId, limit = DEFAULT_LIMIT } = scope;
  const courseFilter = courseId ? eq(documents.courseId, courseId) : undefined;
  const tsq = sql`plainto_tsquery('english', ${query})`;
  const rank = sql`ts_rank_cd(to_tsvector('english', ${textbookChapters.markdown}), ${tsq})`;

  const rows = await db
    .select({
      documentId: textbookChapters.documentId,
      documentTitle: documents.title,
      ordinal: textbookChapters.ordinal,
      text: textbookChapters.markdown,
      chapterNumber: textbookChapters.chapterNumber,
      title: textbookChapters.title,
    })
    .from(textbookChapters)
    .innerJoin(documents, eq(documents.id, textbookChapters.documentId))
    .where(and(
      eq(textbookChapters.userId, userId),
      courseFilter,
      eq(textbookChapters.status, "ready"),
      sql`to_tsvector('english', ${textbookChapters.markdown}) @@ ${tsq}`,
    ))
    .orderBy(desc(rank))
    .limit(limit);

  return rows.map((r) => ({
    documentId: r.documentId,
    documentTitle: r.documentTitle,
    ordinal: r.ordinal,
    text: r.text ?? "",
    locator: chapterLocator(r.chapterNumber, r.ordinal, r.title),
  }));
}

async function bm25Sections(query: string, scope: SearchScope): Promise<ChunkHit[]> {
  const { userId, courseId, limit = DEFAULT_LIMIT } = scope;
  const courseFilter = courseId ? eq(documents.courseId, courseId) : undefined;
  const tsq = sql`plainto_tsquery('english', ${query})`;
  const rank = sql`ts_rank_cd(to_tsvector('english', ${textbookSections.markdown}), ${tsq})`;

  const rows = await db
    .select({
      documentId: textbookSections.documentId,
      documentTitle: documents.title,
      ordinal: textbookSections.ordinal,
      text: textbookSections.markdown,
      title: textbookSections.title,
      chapterNumber: textbookChapters.chapterNumber,
      chapterOrdinal: textbookChapters.ordinal,
      chapterTitle: textbookChapters.title,
    })
    .from(textbookSections)
    .innerJoin(documents, eq(documents.id, textbookSections.documentId))
    .innerJoin(textbookChapters, eq(textbookChapters.id, textbookSections.chapterId))
    .where(and(
      eq(textbookSections.userId, userId),
      courseFilter,
      eq(textbookSections.status, "ready"),
      sql`to_tsvector('english', ${textbookSections.markdown}) @@ ${tsq}`,
    ))
    .orderBy(desc(rank))
    .limit(limit);

  return rows.map((r) => ({
    documentId: r.documentId,
    documentTitle: r.documentTitle,
    ordinal: r.ordinal,
    text: r.text ?? "",
    locator: `${chapterLocator(r.chapterNumber, r.chapterOrdinal, r.chapterTitle)} §${r.title}`,
  }));
}

/** Combines chapter- and section-level grep hits, interleaved so neither granularity starves the other. */
export async function grepTextbookTree(pattern: string, scope: SearchScope): Promise<ChunkHit[]> {
  const limit = scope.limit ?? DEFAULT_LIMIT;
  const [chapters, sections] = await Promise.all([grepChapters(pattern, scope), grepSections(pattern, scope)]);
  return interleave(chapters, sections, limit);
}

/** Combines chapter- and section-level BM25 hits, interleaved. */
export async function bm25TextbookTree(query: string, scope: SearchScope): Promise<ChunkHit[]> {
  const limit = scope.limit ?? DEFAULT_LIMIT;
  const [chapters, sections] = await Promise.all([bm25Chapters(query, scope), bm25Sections(query, scope)]);
  return interleave(chapters, sections, limit);
}
