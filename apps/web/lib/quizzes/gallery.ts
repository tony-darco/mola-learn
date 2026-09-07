/**
 * Server-side reads backing the Quizzes gallery page (§9). Same ownership
 * convention as lib/flashcards/gallery.ts — every quiz returned here is
 * scoped to the caller's own userId AND filtered to kind='quiz' at the
 * query itself.
 */
import { and, desc, eq } from "drizzle-orm";
import { artifacts, db } from "@mola/db";
import { artifactRecordSchema, type ArtifactRecord } from "@mola/shared";

export type { CourseOption, TermOption } from "../artifacts/filters";
export { listCoursesForFilters, listTermsForFilters } from "../artifacts/filters";

/** Every quiz the caller owns — never another user's. */
export async function listQuizzes(userId: string): Promise<ArtifactRecord[]> {
  const rows = await db
    .select()
    .from(artifacts)
    .where(and(eq(artifacts.userId, userId), eq(artifacts.kind, "quiz")))
    .orderBy(desc(artifacts.createdAt));
  return rows.map((r) => artifactRecordSchema.parse(r));
}
