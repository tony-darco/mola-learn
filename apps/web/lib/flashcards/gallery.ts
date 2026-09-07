/**
 * Server-side reads backing the Flashcards gallery page (§9): every deck
 * returned here is scoped to the caller's own `userId` AND filtered to
 * `kind = 'flashcard_deck'` at the query itself — the same ownership
 * convention every other route follows (see lib/auth/ownership.ts), just
 * applied to a list instead of a single `requireOwned` lookup.
 */
import { and, desc, eq } from "drizzle-orm";
import { artifacts, db } from "@mola/db";
import { artifactRecordSchema, type ArtifactRecord } from "@mola/shared";

export type { CourseOption, TermOption } from "../artifacts/filters";
export { listCoursesForFilters, listTermsForFilters } from "../artifacts/filters";

/** Every flashcard deck the caller owns — never another user's. */
export async function listFlashcardDecks(userId: string): Promise<ArtifactRecord[]> {
  const rows = await db
    .select()
    .from(artifacts)
    .where(and(eq(artifacts.userId, userId), eq(artifacts.kind, "flashcard_deck")))
    .orderBy(desc(artifacts.createdAt));
  return rows.map((r) => artifactRecordSchema.parse(r));
}
