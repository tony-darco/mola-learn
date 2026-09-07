/**
 * Agent E — chat-driven quiz mode (§6, Phase 1.5).
 *
 * The agent surfaces a due card's front, the student TYPES an answer, and the
 * agent itself judges correctness against the card's back (already in its
 * context from get_due_flashcards) — grading is the model's own reasoning,
 * not a separate tool, so it can also fire the elaborative-interrogation
 * follow-up (hint-ladder.ts) in the same turn. record_flashcard_review is
 * purely the deterministic SRS bookkeeping half.
 */
import { z } from "zod";
import { and, asc, eq, lte, sql } from "drizzle-orm";
import { cardSrsState, db, flashcards } from "@mola/db";
import type { Tool } from "../registry";
import { scheduleReview, type SrsState } from "../srs";

const dueInputSchema = z.object({
  courseId: z.string().uuid().optional().describe("Restrict to one course; defaults to the chat's own course"),
  limit: z.number().int().min(1).max(20).optional().describe("Max cards to fetch (default 5)"),
});

export const getDueFlashcardsTool: Tool<z.infer<typeof dueInputSchema>> = {
  name: "get_due_flashcards",
  description:
    "Fetch the student's due flashcards for chat-driven quiz mode. Returns front, back, and card id " +
    "for each — use the front to quiz the student, the back to judge their typed answer.",
  inputSchema: dueInputSchema,
  label: () => "Fetching due flashcards",

  async execute(input, ctx) {
    const courseId = input.courseId ?? ctx.courseId ?? undefined;

    const rows = await db
      .select({
        cardId: flashcards.id,
        front: flashcards.front,
        back: flashcards.back,
        chapter: flashcards.chapter,
        section: flashcards.section,
        dueAt: cardSrsState.dueAt,
      })
      .from(cardSrsState)
      .innerJoin(flashcards, eq(flashcards.id, cardSrsState.cardId))
      .where(and(
        eq(cardSrsState.userId, ctx.session.userId),
        // Compared against Postgres's own now() rather than an app-computed
        // Date — the app and DB host can have clock skew (confirmed live: a
        // card's DB-defaulted dueAt read as "not due yet" against this
        // laptop's clock seconds after insert), and dueAt itself always
        // comes from the DB side (defaultNow() or scheduleReview's output
        // written back), so the comparison should too.
        lte(cardSrsState.dueAt, sql`now()`),
        ...(courseId ? [eq(flashcards.courseId, courseId)] : []),
      ))
      .orderBy(asc(cardSrsState.dueAt))
      .limit(input.limit ?? 5);

    if (rows.length === 0) return "No flashcards are due right now.";
    return rows;
  },
};

const reviewInputSchema = z.object({
  cardId: z.string().uuid(),
  rating: z.enum(["again", "hard", "good", "easy"])
    .describe("again = wrong/forgot, hard = correct but effortful, good = correct, easy = correct and trivial"),
});

export const recordFlashcardReviewTool: Tool<z.infer<typeof reviewInputSchema>> = {
  name: "record_flashcard_review",
  description:
    "Record the outcome of a chat-driven flashcard review after judging the student's typed answer. " +
    "Updates the card's SRS schedule so it comes due again at the right time.",
  inputSchema: reviewInputSchema,
  label: (input) => `Recording review: ${input.rating}`,

  async execute(input, ctx) {
    const [srs] = await db.select().from(cardSrsState)
      .where(eq(cardSrsState.cardId, input.cardId)).limit(1);

    if (!srs || srs.userId !== ctx.session.userId) {
      return { error: "card not found" };
    }

    const next = scheduleReview(
      {
        stability: srs.stability,
        difficulty: srs.difficulty,
        reps: srs.reps,
        lapses: srs.lapses,
        state: srs.state as SrsState,
      },
      input.rating,
    );

    await db.update(cardSrsState).set({
      stability: next.stability,
      difficulty: next.difficulty,
      dueAt: next.dueAt,
      reps: next.reps,
      lapses: next.lapses,
      state: next.state,
      lastReviewedAt: new Date(),
    }).where(eq(cardSrsState.id, srs.id));

    return { dueAt: next.dueAt.toISOString(), state: next.state, reps: next.reps };
  },
};
