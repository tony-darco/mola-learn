/**
 * Spaced-repetition scheduler for flashcards (Agent E, §6). Governs which
 * cards come due in BOTH artifact browse mode and chat-driven quiz mode —
 * the same `card_srs_state` row and the same `scheduleReview` call back
 * either path.
 *
 * This is a simplified, FSRS-shaped scheduler (stability/difficulty/state),
 * not the full FSRS-4.5 algorithm — that's fitted per-user from review-history
 * data via an optimizer, which is real overkill for a pilot with no review
 * history yet. The state shape matches FSRS so a real optimizer can slot in
 * later without a schema or call-site change.
 */

export type SrsRating = "again" | "hard" | "good" | "easy";
export type SrsState = "new" | "learning" | "review" | "relearning";

export type SrsCard = {
  stability: number | null;
  difficulty: number | null;
  reps: number;
  lapses: number;
  state: SrsState;
};

export type SrsUpdate = {
  stability: number;
  difficulty: number;
  dueAt: Date;
  reps: number;
  lapses: number;
  state: SrsState;
};

const MIN_DIFFICULTY = 1;
const MAX_DIFFICULTY = 10;
const DEFAULT_DIFFICULTY = 5;

const DIFFICULTY_DELTA: Record<SrsRating, number> = {
  again: 1.2,
  hard: 0.4,
  good: 0,
  easy: -0.4,
};

/** Stability multiplier on a successful review — larger for an easier rating
 * and for a card that's already easy (low difficulty). */
function stabilityFactor(rating: "hard" | "good" | "easy", difficulty: number): number {
  const base = rating === "hard" ? 1.3 : rating === "good" ? 2.2 : 3.4;
  const easeAdjust = 1 + (DEFAULT_DIFFICULTY - difficulty) * 0.05;
  return Math.max(1.1, base * easeAdjust);
}

export function scheduleReview(card: SrsCard, rating: SrsRating, now: Date = new Date()): SrsUpdate {
  const prevDifficulty = card.difficulty ?? DEFAULT_DIFFICULTY;
  const difficulty = Math.min(MAX_DIFFICULTY, Math.max(MIN_DIFFICULTY, prevDifficulty + DIFFICULTY_DELTA[rating]));

  if (rating === "again") {
    return {
      stability: 1,
      difficulty,
      dueAt: addDays(now, 1),
      reps: card.reps + 1,
      lapses: card.lapses + 1,
      state: card.state === "new" ? "learning" : "relearning",
    };
  }

  const prevStability = card.stability ?? 1;
  const stability = prevStability * stabilityFactor(rating, difficulty);

  return {
    stability,
    difficulty,
    dueAt: addDays(now, stability),
    reps: card.reps + 1,
    lapses: card.lapses,
    state: "review",
  };
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}
