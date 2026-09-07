/**
 * Course/term filter options shared by every artifact gallery (flashcards,
 * quizzes, mind maps — §8). Extracted out of lib/flashcards/gallery.ts once
 * a second gallery needed the same two reads, rather than one gallery
 * importing from another feature's module.
 */
import { eq } from "drizzle-orm";
import { courses, db, terms } from "@mola/db";

export type CourseOption = { id: string; name: string; number: string | null; termId: string | null };
export type TermOption = { id: string; label: string };

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
