"use server";

/**
 * Server actions backing the quiz Take/Edit UI. Like every other action in
 * this app, this re-derives the session and checks ownership itself (§9).
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { artifacts, db, quizAttempts } from "@mola/db";
import { quizPayloadSchema, quizQuestionSchema } from "@mola/shared";
import type { z } from "zod";
import { AuthzError, requireOwned, requireSession } from "@/lib/auth/ownership";
import { gradeQuiz } from "./grading";

type QuizQuestion = z.infer<typeof quizQuestionSchema>;

async function requireOwnQuiz(quizId: string, userId: string) {
  const row = await requireOwned("artifact", quizId).catch((err) => {
    if (err instanceof AuthzError) throw new Error("quiz not found");
    throw err;
  });
  if (row.userId !== userId || row.kind !== "quiz") throw new Error("quiz not found");
  return row;
}

export type QuestionInput =
  | { id?: string; type: "multiple_choice"; prompt: string; options: string[]; correctIndex: number; explanation?: string | null }
  | { id?: string; type: "short_answer"; prompt: string; expectedAnswer: string; explanation?: string | null };

/**
 * Replaces a quiz's question set — same discipline as flashcards'
 * updateDeckCardsAction: ids are PRESERVED for surviving questions (so a
 * quiz_attempts row's answers, keyed by question id, still line up after an
 * edit) and minted fresh for new ones. An id the caller doesn't already own
 * on THIS quiz is discarded rather than trusted.
 */
export async function updateQuizQuestionsAction(quizId: string, questions: QuestionInput[]): Promise<void> {
  const session = await requireSession();
  const quiz = await requireOwnQuiz(quizId, session.userId);

  const existing = quizPayloadSchema.safeParse(quiz.payload);
  const knownIds = new Set(existing.success ? existing.data.questions.map((q) => q.id) : []);
  const difficulty = existing.success ? existing.data.difficulty : "standard";

  const next: QuizQuestion[] = questions
    .filter((q) => q.prompt.trim() && (q.type === "short_answer" ? q.expectedAnswer.trim() : q.options.every((o) => o.trim())))
    .map((q) => {
      const id = q.id && knownIds.has(q.id) ? q.id : randomUUID();
      return q.type === "multiple_choice"
        ? { type: "multiple_choice" as const, id, prompt: q.prompt.trim(), options: q.options, correctIndex: q.correctIndex, explanation: q.explanation ?? null }
        : { type: "short_answer" as const, id, prompt: q.prompt.trim(), expectedAnswer: q.expectedAnswer.trim(), explanation: q.explanation ?? null };
    });

  const payload = quizPayloadSchema.parse({ kind: "quiz", difficulty, questions: next });

  await db.update(artifacts)
    .set({ payload, version: quiz.version + 1, updatedAt: new Date() })
    .where(eq(artifacts.id, quizId));

  revalidatePath(`/quizzes/${quizId}`);
  revalidatePath("/quizzes");
}

/**
 * Deterministic grading — no LLM call. Only multiple_choice questions are
 * scored (short_answer has no single correct index to compare against);
 * they still count toward totalQuestions so the denominator matches what
 * the student actually saw.
 */
export async function submitQuizAttemptAction(
  quizId: string,
  answers: Record<string, number>,
): Promise<{ attemptId: string; score: number; total: number }> {
  const session = await requireSession();
  const quiz = await requireOwnQuiz(quizId, session.userId);
  const payload = quizPayloadSchema.parse(quiz.payload);
  const { score, total } = gradeQuiz(payload.questions, answers);

  const [attempt] = await db.insert(quizAttempts).values({
    userId: session.userId,
    quizId,
    score,
    totalQuestions: total,
    answers,
    completedAt: new Date(),
  }).returning();

  return { attemptId: attempt!.id, score, total };
}
