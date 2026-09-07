/**
 * Learn mode's session queue.
 *
 * The queue is a list of indices into the deck, and it GROWS as the student
 * misses cards: a 20-card deck with one "No" becomes a 22-pass session. The
 * deck itself is never touched — this lives in component state and dies with
 * the page. Persisted scheduling is a separate concern (lib/flashcards/actions.ts).
 */

export type Grade = "yes" | "close" | "no";

/** Extra passes earned per grade. "No" twice more, "Close" once, "Yes" none. */
export const REQUEUE_COUNT: Record<Grade, number> = { yes: 0, close: 1, no: 2 };

/** "Close" still counts as correct in the running score — it only costs a repeat. */
export const COUNTS_AS_CORRECT: Record<Grade, boolean> = { yes: true, close: true, no: false };

/**
 * Returns a new queue with `cardIndex` reinserted `REQUEUE_COUNT[grade]` times
 * at random positions strictly after `position`, so a missed card comes back
 * later in the sitting rather than immediately.
 *
 * `random` is injectable so the shuffle is testable; it must return [0, 1).
 */
export function requeue(
  queue: number[],
  position: number,
  cardIndex: number,
  grade: Grade,
  random: () => number = Math.random,
): number[] {
  const extra = REQUEUE_COUNT[grade];
  if (extra === 0) return queue;

  const next = [...queue];
  for (let k = 0; k < extra; k++) {
    const lo = position + 1;
    const span = next.length - lo + 1;
    const at = lo + Math.floor(random() * span);
    next.splice(at, 0, cardIndex);
  }
  return next;
}
