/**
 * Server-side read backing the unified Artifacts page (§8, design doc):
 * "filterable by course, searchable by topic... shows flashcard decks,
 * quizzes, mind maps." Complements, not replaces, the Flashcards/Quizzes
 * pages — this is the "everything I've made" overview across kinds; those
 * stay the dedicated per-kind surfaces linked from the sidebar.
 */
import { desc, eq } from "drizzle-orm";
import { artifacts, db } from "@mola/db";
import { artifactRecordSchema, type ArtifactRecord } from "@mola/shared";

/** Every artifact the caller owns, any kind — never another user's. */
export async function listAllArtifacts(userId: string): Promise<ArtifactRecord[]> {
  const rows = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.userId, userId))
    .orderBy(desc(artifacts.createdAt));
  return rows.map((r) => artifactRecordSchema.parse(r));
}
