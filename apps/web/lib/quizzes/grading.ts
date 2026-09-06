/**
 * Deterministic quiz grading — no LLM call, ever (§6, explicit requirement).
 * Pure function, same reasoning as lib/agent/srs.ts's own extraction: the
 * behavior that actually matters should be unit-testable without a database.
 */
import type { z } from "zod";
import type { quizQuestionSchema } from "@mola/shared";

type Question = z.infer<typeof quizQuestionSchema>;

export type GradeResult = { score: number; total: number };

/**
 * Only multiple_choice questions are scored (short_answer has no single
 * correct index to compare against) — they still count toward `total` so
 * the denominator matches what the student actually saw on the page.
 */
export function gradeQuiz(questions: Question[], answers: Record<string, number>): GradeResult {
  let score = 0;
  for (const q of questions) {
    if (q.type === "multiple_choice" && answers[q.id] === q.correctIndex) score += 1;
  }
  return { score, total: questions.length };
}
