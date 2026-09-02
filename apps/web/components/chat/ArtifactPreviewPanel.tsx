"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArtifactBlock } from "./artifacts/ArtifactBlock";
import { ARTIFACT_FIXTURES } from "./fixtures";

/**
 * Dev-only preview of the flashcard/quiz/mind-map renderers, built against
 * contract 6's schema ahead of the agents that will produce them for real.
 * Lives in its own side panel rather than the conversation — it was never a
 * real turn, so it shouldn't look like one.
 */
const TABS = [
  { key: "flashcard_deck", label: "Flashcards" },
  { key: "quiz", label: "Quiz" },
  { key: "mind_map", label: "Overview" },
] as const;

const DEFAULT_WIDTH = 384;
const MIN_WIDTH = 280;
const MAX_WIDTH = 720;

export function ArtifactPreviewPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("flashcard_deck");
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const dragStart = useRef<{ x: number; width: number } | null>(null);
  const artifact = ARTIFACT_FIXTURES.find((a) => a.kind === tab);

  const onPointerMove = useCallback((e: PointerEvent) => {
    if (!dragStart.current) return;
    const delta = dragStart.current.x - e.clientX;
    const next = Math.min(Math.max(dragStart.current.width + delta, MIN_WIDTH), MAX_WIDTH);
    setWidth(next);
  }, []);

  const onPointerUp = useCallback(() => {
    dragStart.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }, [onPointerMove]);

  useEffect(() => () => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }, [onPointerMove, onPointerUp]);

  function startDrag(e: React.PointerEvent) {
    dragStart.current = { x: e.clientX, width };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  return (
    <aside className="relative flex h-full shrink-0 flex-col overflow-hidden border-l border-border bg-surface" style={{ width }}>
      {/* Wider than the visible border for an easy grab target; the border itself is the only visible line. */}
      <div
        onPointerDown={startDrag}
        className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize artifact preview panel"
      />

      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="text-base font-semibold text-fg">Artifact previews</span>
        <button
          type="button"
          className="rounded-md px-1.5 py-0.5 text-fg-muted hover:bg-bg hover:text-fg"
          onClick={onClose}
          aria-label="Close artifact previews"
        >
          ✕
        </button>
      </div>

      <div className="flex gap-1 p-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`rounded-md px-2.5 py-1 text-sm ${
              tab === t.key ? "bg-accent text-accent-fg" : "text-fg-muted hover:bg-bg"
            }`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto bg-bg p-3">
        {artifact && <ArtifactBlock artifact={artifact} />}
      </div>
    </aside>
  );
}
