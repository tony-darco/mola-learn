import { describe, expect, it } from "vitest";
import { COUNTS_AS_CORRECT, REQUEUE_COUNT, requeue } from "../lib/flashcards/learn-queue";

/** A 20-card deck, the example the behaviour was specified against. */
const deck20 = Array.from({ length: 20 }, (_, i) => i);

describe("Learn mode session queue", () => {
  it("'yes' does not grow the session", () => {
    const next = requeue(deck20, 0, 0, "yes");
    expect(next).toHaveLength(20);
    expect(next).toEqual(deck20);
  });

  it("'close' adds exactly one extra pass", () => {
    const next = requeue(deck20, 0, 0, "close", () => 0.5);
    expect(next).toHaveLength(21);
    expect(next.filter((i) => i === 0)).toHaveLength(2);
  });

  it("'no' turns a 20-card deck into a 22-pass session", () => {
    const next = requeue(deck20, 0, 0, "no", () => 0.5);
    expect(next).toHaveLength(22);
    expect(next.filter((i) => i === 0)).toHaveLength(3);
  });

  it("never reinserts at or before the current position", () => {
    // random() = 0 puts every insert at the earliest position allowed.
    const next = requeue(deck20, 7, 7, "no", () => 0);
    expect(next.slice(0, 8)).toEqual(deck20.slice(0, 8));
    expect(next[8]).toBe(7);
  });

  it("can reinsert at the very end when random() approaches 1", () => {
    const next = requeue([0, 1, 2], 2, 2, "close", () => 0.999);
    expect(next).toEqual([0, 1, 2, 2]);
  });

  it("requeues from the last card without losing the insert", () => {
    const next = requeue([0, 1, 2], 2, 2, "no", () => 0);
    expect(next).toHaveLength(5);
    expect(next.filter((i) => i === 2)).toHaveLength(3);
  });

  it("does not mutate the queue it was given", () => {
    const original = [...deck20];
    requeue(deck20, 0, 0, "no", () => 0.5);
    expect(deck20).toEqual(original);
  });

  it("grades 'no' more heavily than 'close', and 'yes' not at all", () => {
    expect(REQUEUE_COUNT.no).toBeGreaterThan(REQUEUE_COUNT.close);
    expect(REQUEUE_COUNT.close).toBeGreaterThan(REQUEUE_COUNT.yes);
    expect(REQUEUE_COUNT.yes).toBe(0);
  });

  it("counts 'close' as correct but 'no' as a miss", () => {
    expect(COUNTS_AS_CORRECT.yes).toBe(true);
    expect(COUNTS_AS_CORRECT.close).toBe(true);
    expect(COUNTS_AS_CORRECT.no).toBe(false);
  });
});
