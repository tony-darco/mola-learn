"use server";

/**
 * Server actions backing the courses UI (§8). Every action re-derives the
 * session and checks ownership itself — a server action is just another
 * request handler, so it gets no less scrutiny than a route (§9).
 */
import { and, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { chats, courseMemory, courses, db, terms } from "@mola/db";
import type { DocumentKind } from "@/lib/documents/ingest-handoff";
import { uploadDocumentAndEnqueue } from "@/lib/documents/ingest-handoff";
import { requireOwned, requireSession } from "@/lib/auth/ownership";

async function requireOwnTerm(userId: string, termId: string) {
  const [term] = await db.select().from(terms).where(and(eq(terms.id, termId), eq(terms.userId, userId))).limit(1);
  if (!term) throw new Error("that term does not belong to you");
  return term;
}

export async function createCourseAction(formData: FormData) {
  const session = await requireSession();

  const name = String(formData.get("name") ?? "").trim();
  const number = String(formData.get("number") ?? "").trim() || null;
  const professor = String(formData.get("professor") ?? "").trim() || null;
  const termId = String(formData.get("termId") ?? "");
  if (!name || !termId) throw new Error("name and term are required");

  await requireOwnTerm(session.userId, termId);

  // The summary is generated FROM the syllabus, not filled in here (§8). It
  // stays null — an honest "generating…" state — until Agent B's worker runs.
  const [course] = await db
    .insert(courses)
    .values({ userId: session.userId, termId, name, number, professor, summary: null })
    .returning();

  const syllabus = formData.get("syllabus");
  if (syllabus instanceof File && syllabus.size > 0) {
    await uploadDocumentAndEnqueue({
      userId: session.userId,
      courseId: course!.id,
      kind: "syllabus",
      file: syllabus,
    });
  }

  redirect(`/courses/${course!.id}`);
}

export async function updateCourseSummaryAction(formData: FormData) {
  const session = await requireSession();
  const courseId = String(formData.get("courseId") ?? "");
  const summary = String(formData.get("summary") ?? "").trim();

  await requireOwned("course", courseId, session);
  await db.update(courses).set({ summary: summary || null }).where(eq(courses.id, courseId));
  redirect(`/courses/${courseId}`);
}

export async function updateCourseInstructionsAction(formData: FormData) {
  const session = await requireSession();
  const courseId = String(formData.get("courseId") ?? "");
  const professor = String(formData.get("professor") ?? "").trim() || null;
  const instructions = String(formData.get("instructions") ?? "").trim() || null;

  await requireOwned("course", courseId, session);
  await db.update(courses).set({ professor, instructions }).where(eq(courses.id, courseId));
  redirect(`/courses/${courseId}`);
}

/** Panel 2 — per-course memory (§8). One row per course; upsert on the unique index. */
export async function updateCourseMemoryAction(formData: FormData) {
  const session = await requireSession();
  const courseId = String(formData.get("courseId") ?? "");
  const content = String(formData.get("content") ?? "").trim();

  await requireOwned("course", courseId, session);

  const [existing] = await db.select().from(courseMemory).where(eq(courseMemory.courseId, courseId)).limit(1);
  if (existing) {
    await db.update(courseMemory).set({ content, updatedAt: new Date() }).where(eq(courseMemory.id, existing.id));
  } else if (content) {
    await db.insert(courseMemory).values({ userId: session.userId, courseId, content });
  }
  redirect(`/courses/${courseId}`);
}

/** Panel 3 — Context. Same three-step handoff as course creation (§12). */
export async function uploadCourseDocumentAction(formData: FormData) {
  const session = await requireSession();
  const courseId = String(formData.get("courseId") ?? "");
  const kind = String(formData.get("kind") ?? "student_notes") as DocumentKind;
  const file = formData.get("file");

  await requireOwned("course", courseId, session);
  if (!(file instanceof File) || file.size === 0) throw new Error("a file is required");

  await uploadDocumentAndEnqueue({ userId: session.userId, courseId, kind, file });
  redirect(`/courses/${courseId}`);
}

export async function listCourseChats(userId: string, courseId: string) {
  return db
    .select()
    .from(chats)
    .where(and(eq(chats.courseId, courseId), eq(chats.userId, userId)))
    .orderBy(desc(chats.createdAt));
}
