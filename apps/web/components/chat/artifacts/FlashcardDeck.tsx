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
    return <div className="artifact-empty">This deck has no cards yet.</div>;
  }

  const go = (delta: number) => {
    setFlipped(false);
    setIndex((i) => Math.min(Math.max(i + delta, 0), payload.cards.length - 1));
  };

  return (
    <div className="flashcard-deck">
      <div className="flashcard-deck-header">
        <span>{title}</span>
        <span className="flashcard-deck-count">{index + 1} / {payload.cards.length}</span>
      </div>
      <button
        type="button"
        className="flashcard"
        onClick={() => setFlipped((f) => !f)}
        aria-label={flipped ? "Showing answer, click to show question" : "Showing question, click to reveal answer"}
      >
        <div className="flashcard-face">{flipped ? card.back : card.front}</div>
        <div className="flashcard-hint">{flipped ? "Answer — click to flip back" : "Click to reveal answer"}</div>
      </button>
      {(card.chapter || card.section) && (
        <div className="flashcard-meta">
          {[card.chapter, card.section].filter(Boolean).join(" · ")}
        </div>
      )}
      <div className="flashcard-nav">
        <button type="button" onClick={() => go(-1)} disabled={index === 0}>← Prev</button>
        <button type="button" onClick={() => go(1)} disabled={index === payload.cards.length - 1}>Next →</button>
      </div>
    </div>
  );
}
