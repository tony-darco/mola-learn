import { describe, expect, it } from "vitest";
import { scheduleReview, type SrsCard } from "../lib/agent/srs";

const NOW = new Date("2026-01-01T00:00:00Z");

function newCard(overrides: Partial<SrsCard> = {}): SrsCard {
  return { stability: null, difficulty: null, reps: 0, lapses: 0, state: "new", ...overrides };
}

describe("scheduleReview", () => {
  it("a new card rated 'again' goes to learning, due ~1 day out, one lapse", () => {
    const next = scheduleReview(newCard(), "again", NOW);
    expect(next.state).toBe("learning");
    expect(next.lapses).toBe(1);
    expect(next.reps).toBe(1);
    expect(next.stability).toBe(1);
    expect(next.dueAt.getTime()).toBe(NOW.getTime() + 24 * 60 * 60 * 1000);
  });

  it("a new card rated 'good' moves to review, due in the future, no lapse", () => {
    const next = scheduleReview(newCard(), "good", NOW);
    expect(next.state).toBe("review");
    expect(next.lapses).toBe(0);
    expect(next.reps).toBe(1);
    expect(next.dueAt.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("'easy' schedules further out than 'good', which schedules further than 'hard'", () => {
    const hard = scheduleReview(newCard(), "hard", NOW);
    const good = scheduleReview(newCard(), "good", NOW);
    const easy = scheduleReview(newCard(), "easy", NOW);
    expect(easy.stability).toBeGreaterThan(good.stability);
    expect(good.stability).toBeGreaterThan(hard.stability);
  });

  it("an established review card that lapses goes to relearning, not learning", () => {
    const established: SrsCard = { stability: 20, difficulty: 4, reps: 5, lapses: 0, state: "review" };
    const next = scheduleReview(established, "again", NOW);
    expect(next.state).toBe("relearning");
    expect(next.lapses).toBe(1);
    expect(next.stability).toBe(1);
  });

  it("difficulty stays clamped to [1, 10] under repeated extreme ratings", () => {
    let card = newCard();
    for (let i = 0; i < 20; i++) {
      const next = scheduleReview(card, "again", NOW);
      card = { stability: next.stability, difficulty: next.difficulty, reps: next.reps, lapses: next.lapses, state: next.state };
    }
    expect(card.difficulty).toBeLessThanOrEqual(10);
    expect(card.difficulty).toBeGreaterThanOrEqual(1);

    let easyCard = newCard();
    for (let i = 0; i < 20; i++) {
      const next = scheduleReview(easyCard, "easy", NOW);
      easyCard = { stability: next.stability, difficulty: next.difficulty, reps: next.reps, lapses: next.lapses, state: next.state };
    }
    expect(easyCard.difficulty).toBeGreaterThanOrEqual(1);
  });

  it("stability compounds across successive successful reviews", () => {
    const first = scheduleReview(newCard(), "good", NOW);
    const second = scheduleReview(
      { stability: first.stability, difficulty: first.difficulty, reps: first.reps, lapses: first.lapses, state: first.state },
      "good",
      first.dueAt,
    );
    expect(second.stability).toBeGreaterThan(first.stability);
    expect(second.reps).toBe(2);
  });
});
