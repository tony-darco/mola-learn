/**
 * Document status scoping — the piece that makes §6's rule real:
 *
 *   "The agent checks documents.status and receives a clear 'not indexed'
 *    signal, then falls back to grep/BM25. It never guesses."
 *
 * A document mid-pipeline (scanning/extracting/indexing) must not be silently
 * treated as absent, and must not be silently treated as searchable either.
 * Every retrieval tool scopes through here so "ready" means the same thing
 * everywhere.
 */
import { and, eq } from "drizzle-orm";
import { db, documents } from "@mola/db";

export type ScopedDocument = {
  id: string;
  title: string;
  kind: string;
  status: string;
};

/** Documents visible to a retrieval call: owned by this user, optionally scoped to a course. */
export async function scopedDocuments(
  userId: string,
  courseId: string | null,
): Promise<ScopedDocument[]> {
  const where = courseId
    ? and(eq(documents.userId, userId), eq(documents.courseId, courseId))
    : eq(documents.userId, userId);

  return db
    .select({ id: documents.id, title: documents.title, kind: documents.kind, status: documents.status })
    .from(documents)
    .where(where);
}

export function readyIds(docs: ScopedDocument[]): string[] {
  return docs.filter((d) => d.status === "ready").map((d) => d.id);
}

export function notReadyDocs(docs: ScopedDocument[]): ScopedDocument[] {
  return docs.filter((d) => d.status !== "ready");
}

/** One-line, student-facing note about what vector search could not cover. */
export function formatPendingNote(pending: ScopedDocument[]): string | null {
  if (pending.length === 0) return null;
  const list = pending.map((d) => `"${d.title}" (status: ${d.status})`).join(", ");
  return `Not searchable by vector_search yet — still processing: ${list}.`;
}
