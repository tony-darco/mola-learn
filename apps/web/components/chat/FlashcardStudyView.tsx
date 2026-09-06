"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { z } from "zod";
import type { flashcardSchema } from "@mola/shared";
import { FlashcardLearnMode } from "./FlashcardLearnMode";
import { Markdown } from "./Markdown";

type Card = z.infer<typeof flashcardSchema>;
type Mode = "flashcards" | "learn";

const AUTOPLAY_INTERVAL_MS = 4000;

/**
 * Quizlet-style study view for one deck — its own page (app/(shell)/flashcards/[deckId])
 * rather than a modal, so the sidebar stays put and the URL is shareable.
 * Deliberately separate from artifacts/FlashcardDeck.tsx, which stays as the
 * compact inline renderer for a deck that just landed in a chat turn — this
 * component is for the dedicated studying experience.
 */
export function FlashcardStudyView({ title, cards }: { title: string; cards: Card[] }) {
  const [mode, setMode] = useState<Mode>("flashcards");
  const [order, setOrder] = useState<number[]>(() => cards.map((_, i) => i));
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [hasFlippedOnce, setHasFlippedOnce] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const card = cards[order[index] ?? 0];

  const goTo = (next: number) => {
    setIndex(Math.min(Math.max(next, 0), cards.length - 1));
    setFlipped(false);
  };

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setIndex((i) => {
        if (i >= cards.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
      setFlipped(false);
    }, AUTOPLAY_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [playing, cards.length]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void containerRef.current?.requestFullscreen();
    }
  }

  function shuffle() {
    const next = [...order];
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [next[i], next[j]] = [next[j]!, next[i]!];
    }
    setOrder(next);
    setIndex(0);
    setFlipped(false);
  }

  const termsList = useMemo(() => cards, [cards]);

  if (!card) {
    return <div className="text-sm text-fg-muted">This deck has no cards yet.</div>;
  }

  return (
    <div ref={containerRef} className="relative bg-bg">
      <h1 className="mb-4 text-2xl font-semibold text-fg">{title}</h1>

      {/* Mode tabs, mirroring Quizlet. Test stays a placeholder until the
          quiz-generation feature (Phase 2) exists to power it. */}
      <div className="mb-5 flex gap-3">
        <button
          type="button"
          onClick={() => setMode("flashcards")}
          className={`flex-1 rounded-xl px-4 py-3 text-center text-sm font-medium ${
            mode === "flashcards" ? "bg-accent text-accent-fg" : "bg-surface text-fg hover:opacity-90"
          }`}
        >
          Flashcards
        </button>
        <button
          type="button"
          onClick={() => setMode("learn")}
          className={`flex-1 rounded-xl px-4 py-3 text-center text-sm font-medium ${
            mode === "learn" ? "bg-accent text-accent-fg" : "bg-surface text-fg hover:opacity-90"
          }`}
        >
          Learn
        </button>
        <div
          className="flex-1 cursor-not-allowed rounded-xl bg-surface px-4 py-3 text-center text-sm font-medium text-fg-muted opacity-50"
          title="Coming soon — once quizzes are generated from this deck"
        >
          Test
        </div>
      </div>

      {mode === "learn" && <FlashcardLearnMode cards={cards} />}

      <div className="mb-2 flex justify-end">
        <button
          type="button"
          onClick={() => setShowTerms((v) => !v)}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-fg-muted hover:bg-surface hover:text-fg"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="18" x2="20" y2="18" />
          </svg>
          Terms in this set ({cards.length})
        </button>
      </div>

      {mode === "flashcards" && (
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <button
          type="button"
          onClick={() => {
            setFlipped((f) => !f);
            setHasFlippedOnce(true);
          }}
          className="flex min-h-[340px] w-full flex-col items-center justify-center gap-2 p-10 text-center"
          aria-label={flipped ? "Showing answer, click to show question" : "Showing question, click to reveal answer"}
        >
          <div className="text-xl text-fg [&_.katex-display]:my-2">
            <Markdown text={flipped ? card.back : card.front} />
          </div>
        </button>
        {(card.chapter || card.section) && (
          <div className="px-6 pb-2 text-xs text-fg-muted">
            {[card.chapter && `Ch. ${card.chapter}`, card.section].filter(Boolean).join(" · ")}
          </div>
        )}
        {!flipped && !hasFlippedOnce && (
          <div className="bg-accent px-4 py-3 text-center text-sm font-medium text-accent-fg">
            Click the card to flip
          </div>
        )}
      </div>
      )}

      {mode === "flashcards" && (
      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <IconButton
            title={playing ? "Pause" : "Auto-advance"}
            onClick={() => setPlaying((p) => !p)}
            active={playing}
          >
            {playing ? (
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="5" width="4" height="14" />
                <rect x="14" y="5" width="4" height="14" />
              </svg>
            ) : (
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </IconButton>
          <IconButton title="Shuffle" onClick={shuffle}>
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h4l9 10h3M4 17h4l3.5-4M15 7h4M19 7l-3-3M19 7l-3 3M19 17l-3 3M19 17l-3-3" />
            </svg>
          </IconButton>
        </div>

        <div className="flex items-center gap-4">
          <IconButton title="Previous" onClick={() => goTo(index - 1)} disabled={index === 0}>
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </IconButton>
          <span className="text-sm text-fg-muted">{index + 1} / {cards.length}</span>
          <IconButton title="Next" onClick={() => goTo(index + 1)} disabled={index === cards.length - 1}>
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </IconButton>
        </div>

        <IconButton title={fullscreen ? "Exit fullscreen" : "Fullscreen"} onClick={toggleFullscreen}>
          {fullscreen ? (
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 4v4a1 1 0 01-1 1H4M20 9h-4a1 1 0 01-1-1V4M15 20v-4a1 1 0 011-1h4M4 15h4a1 1 0 011 1v4" />
            </svg>
          ) : (
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 9V5a1 1 0 011-1h4M20 9V5a1 1 0 00-1-1h-4M4 15v4a1 1 0 001 1h4M20 15v4a1 1 0 01-1 1h-4" />
            </svg>
          )}
        </IconButton>
      </div>
      )}

      {showTerms && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowTerms(false)} />
          <div className="fixed right-0 top-0 z-50 h-full w-full max-w-md overflow-y-auto border-l border-border bg-surface p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-fg">Terms in this set ({cards.length})</h2>
              <button
                type="button"
                onClick={() => setShowTerms(false)}
                className="rounded-md px-2 py-1 text-sm text-fg-muted hover:bg-bg hover:text-fg"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="flex flex-col divide-y divide-border">
              {termsList.map((c) => (
                <div key={c.id} className="py-3">
                  <div className="text-sm text-fg"><Markdown text={c.front} /></div>
                  <div className="mt-1.5 text-sm text-fg-muted"><Markdown text={c.back} /></div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function IconButton({
  title, onClick, children, active, disabled,
}: { title: string; onClick: () => void; children: React.ReactNode; active?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-9 w-9 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-30 ${
        active ? "bg-accent text-accent-fg" : "text-fg-muted hover:bg-surface hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}
