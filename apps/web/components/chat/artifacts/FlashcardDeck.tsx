"use client";

import { useState } from "react";
import type { flashcardDeckPayloadSchema } from "@mola/shared";
import type { z } from "zod";

type Payload = z.infer<typeof flashcardDeckPayloadSchema>;

export function FlashcardDeck({ payload, title }: { payload: Payload; title: string }) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const card = payload.cards[index];

  if (!card) {
    return <div className="text-[13.5px] text-fg-muted">This deck has no cards yet.</div>;
  }

  const go = (delta: number) => {
    setFlipped(false);
    setIndex((i) => Math.min(Math.max(i + delta, 0), payload.cards.length - 1));
  };

  return (
    <div>
      <div className="mb-2.5 flex justify-between text-xs text-fg-muted">
        <span>{title}</span>
        <span>{index + 1} / {payload.cards.length}</span>
      </div>
      <button
        type="button"
        className="flex min-h-[120px] w-full flex-col items-center justify-center gap-2 rounded-lg border border-border bg-bg p-5 text-center"
        onClick={() => setFlipped((f) => !f)}
        aria-label={flipped ? "Showing answer, click to show question" : "Showing question, click to reveal answer"}
      >
        <div className="text-[15.5px] text-fg">{flipped ? card.back : card.front}</div>
        <div className="text-[11px] text-fg-muted">{flipped ? "Answer — click to flip back" : "Click to reveal answer"}</div>
      </button>
      {(card.chapter || card.section) && (
        <div className="mt-1.5 text-[11.5px] text-fg-muted">
          {[card.chapter, card.section].filter(Boolean).join(" · ")}
        </div>
      )}
      <div className="mt-2.5 flex justify-between">
        <button
          type="button"
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-fg disabled:cursor-default disabled:opacity-40"
          onClick={() => go(-1)}
          disabled={index === 0}
        >
          ← Prev
        </button>
        <button
          type="button"
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-fg disabled:cursor-default disabled:opacity-40"
          onClick={() => go(1)}
          disabled={index === payload.cards.length - 1}
        >
          Next →
        </button>
      </div>
    </div>
  );
}
