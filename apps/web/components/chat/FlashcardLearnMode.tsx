"use client";

import { useState } from "react";
import type { z } from "zod";
import type { flashcardSchema } from "@mola/shared";
import { recordLearnGradeAction } from "@/lib/flashcards/actions";
import { COUNTS_AS_CORRECT, requeue, type Grade } from "@/lib/flashcards/learn-queue";
import { Markdown } from "./Markdown";

type Card = z.infer<typeof flashcardSchema>;

/**
 * Learn mode: flip, self-grade, and let missed cards come back around.
 *
 * Two separate things happen on each grade, deliberately kept apart:
 *   - the SESSION queue grows (in-memory, this component only)
 *   - the card's real FSRS schedule advances (recordLearnGradeAction), the
 *     same `card_srs_state` row chat-driven quiz mode writes
 */
export function FlashcardLearnMode({ cards }: { cards: Card[] }) {
  const [queue, setQueue] = useState<number[]>(() => cards.map((_, i) => i));
  const [position, setPosition] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [correct, setCorrect] = useState(0);
  const [graded, setGraded] = useState(0);

  const done = position >= queue.length;
  const cardIndex = done ? null : queue[position] ?? null;
  const card = cardIndex === null ? null : cards[cardIndex] ?? null;

  function grade(g: Grade) {
    if (cardIndex === null || !card) return;

    setQueue((q) => requeue(q, position, cardIndex, g));

    if (COUNTS_AS_CORRECT[g]) setCorrect((c) => c + 1);
    setGraded((n) => n + 1);
    setPosition((p) => p + 1);
    setFlipped(false);

    // Persisted scheduling is a side effect of studying, not something the
    // student should wait on between cards.
    void recordLearnGradeAction(card.id, g).catch(() => {
      /* a dropped schedule write must not interrupt the session */
    });
  }

  function restart() {
    setQueue(cards.map((_, i) => i));
    setPosition(0);
    setFlipped(false);
    setCorrect(0);
    setGraded(0);
  }

  if (cards.length === 0) {
    return <div className="text-sm text-fg-muted">This deck has no cards yet.</div>;
  }

  if (done) {
    return (
      <div className="rounded-xl border border-border bg-surface p-10 text-center">
        <div className="text-lg font-semibold text-fg">Session complete</div>
        <div className="mt-2 text-3xl font-semibold text-fg">{correct} / {graded}</div>
        <div className="mt-1 text-sm text-fg-muted">
          {graded > cards.length
            ? `${cards.length} cards, ${graded} passes — the ones you missed came back around.`
            : `${cards.length} cards, straight through.`}
        </div>
        <button
          type="button"
          onClick={restart}
          className="mt-5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg hover:opacity-90"
        >
          Study again
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-sm text-fg-muted">
        <span>Card {position + 1} of {queue.length}</span>
        <span>{correct} / {graded}</span>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <button
          type="button"
          onClick={() => setFlipped(true)}
          disabled={flipped}
          className="flex min-h-[300px] w-full flex-col items-center justify-center gap-2 p-10 text-center disabled:cursor-default"
        >
          <div className="text-xl text-fg">
            <Markdown text={flipped ? card!.back : card!.front} />
          </div>
        </button>
        {(card!.chapter || card!.section) && (
          <div className="px-6 pb-2 text-xs text-fg-muted">
            {[card!.chapter && `Ch. ${card!.chapter}`, card!.section].filter(Boolean).join(" · ")}
          </div>
        )}
        {!flipped && (
          <div className="bg-accent px-4 py-3 text-center text-sm font-medium text-accent-fg">
            Click the card to reveal the answer
          </div>
        )}
      </div>

      {flipped && (
        <div className="mt-4">
          <div className="mb-2 text-center text-sm text-fg-muted">Did you get it right?</div>
          <div className="flex gap-2">
            <GradeButton label="No" hint="see it twice more" onClick={() => grade("no")} />
            <GradeButton label="Close" hint="see it once more" onClick={() => grade("close")} />
            <GradeButton label="Yes" hint="done for this session" onClick={() => grade("yes")} primary />
          </div>
        </div>
      )}
    </div>
  );
}

function GradeButton({
  label, hint, onClick, primary,
}: { label: string; hint: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-xl border px-4 py-3 text-center ${
        primary
          ? "border-accent bg-accent text-accent-fg hover:opacity-90"
          : "border-border bg-surface text-fg hover:border-accent"
      }`}
    >
      <div className="text-sm font-semibold">{label}</div>
      <div className={`text-xs ${primary ? "opacity-80" : "text-fg-muted"}`}>{hint}</div>
    </button>
  );
}
