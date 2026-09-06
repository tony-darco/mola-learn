/**
 * Server-side reads backing the Flashcards gallery page (§9): every deck
 * returned here is scoped to the caller's own `userId` AND filtered to
 * `kind = 'flashcard_deck'` at the query itself — the same ownership
 * convention every other route follows (see lib/auth/ownership.ts), just
 * applied to a list instead of a single `requireOwned` lookup.
 */
import { and, desc, eq } from "drizzle-orm";
import { artifacts, courses, db, terms } from "@mola/db";
import { artifactRecordSchema, type ArtifactRecord } from "@mola/shared";

export type CourseOption = { id: string; name: string; number: string | null; termId: string | null };
export type TermOption = { id: string; label: string };

/** Every flashcard deck the caller owns — never another user's. */
export async function listFlashcardDecks(userId: string): Promise<ArtifactRecord[]> {
  const rows = await db
    .select()
    .from(artifacts)
    .where(and(eq(artifacts.userId, userId), eq(artifacts.kind, "flashcard_deck")))
    .orderBy(desc(artifacts.createdAt));
  return rows.map((r) => artifactRecordSchema.parse(r));
}

/** Backs the course filter — the caller's own courses only. */
export async function listCoursesForFilters(userId: string): Promise<CourseOption[]> {
  return db
    .select({ id: courses.id, name: courses.name, number: courses.number, termId: courses.termId })
    .from(courses)
    .where(eq(courses.userId, userId));
}

/** Backs the semester/year filter — the caller's own terms only. */
export async function listTermsForFilters(userId: string): Promise<TermOption[]> {
  return db.select({ id: terms.id, label: terms.label }).from(terms).where(eq(terms.userId, userId));
}
