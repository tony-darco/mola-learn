"use server";

/**
 * Server actions backing the Flashcards study UI. Like every other action in
 * this app, this re-derives the session and checks ownership itself — a
 * server action is just another request handler (§9).
 */
import { eq } from "drizzle-orm";
import { cardSrsState, db, flashcards } from "@mola/db";
import { requireSession } from "@/lib/auth/ownership";
import { scheduleReview, type SrsRating, type SrsState } from "@/lib/agent/srs";

/** Learn mode's three buttons, mapped onto the scheduler's rating scale. */
const RATING_FOR_GRADE: Record<"yes" | "close" | "no", SrsRating> = {
  yes: "good",
  close: "hard",
  no: "again",
};

/**
 * Records one Learn-mode self-grade against the card's real FSRS state — the
 * same `card_srs_state` row the chat-driven quiz mode writes, so studying in
 * either surface moves the same schedule.
 *
 * Note this is the *persisted* half only. Learn mode's requeueing (a missed
 * card coming back around later in the same sitting) is session-local and
 * never touches the deck or this table.
 */
export async function recordLearnGradeAction(cardId: string, grade: "yes" | "close" | "no"): Promise<void> {
  const session = await requireSession();

  // Ownership: the card itself must belong to the caller. Checked against
  // `flashcards`, not `card_srs_state`, so a card with no state row yet is
  // still verified before we create one.
  const [card] = await db.select().from(flashcards).where(eq(flashcards.id, cardId)).limit(1);
  if (!card || card.userId !== session.userId) return;

  const [existing] = await db.select().from(cardSrsState)
    .where(eq(cardSrsState.cardId, cardId)).limit(1);

  const next = scheduleReview(
    {
      stability: existing?.stability ?? null,
      difficulty: existing?.difficulty ?? null,
      reps: existing?.reps ?? 0,
      lapses: existing?.lapses ?? 0,
      state: (existing?.state as SrsState) ?? "new",
    },
    RATING_FOR_GRADE[grade],
  );

  const values = {
    stability: next.stability,
    difficulty: next.difficulty,
    dueAt: next.dueAt,
    reps: next.reps,
    lapses: next.lapses,
    state: next.state,
    lastReviewedAt: new Date(),
  };

  if (existing) {
    await db.update(cardSrsState).set(values).where(eq(cardSrsState.id, existing.id));
  } else {
    // A deck whose cards predate the denormalization step has no state row —
    // create it rather than dropping the review on the floor.
    await db.insert(cardSrsState).values({ userId: session.userId, cardId, ...values });
  }
}
