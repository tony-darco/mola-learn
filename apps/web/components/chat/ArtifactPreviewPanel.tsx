"use client";

import { useState } from "react";
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

export function ArtifactPreviewPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("flashcard_deck");
  const artifact = ARTIFACT_FIXTURES.find((a) => a.kind === tab);

  return (
    <aside className="flex h-full w-96 shrink-0 flex-col overflow-hidden border-l border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <span className="text-sm font-semibold text-fg">Artifact previews</span>
        <button
          type="button"
          className="rounded-md px-1.5 py-0.5 text-fg-muted hover:bg-bg hover:text-fg"
          onClick={onClose}
          aria-label="Close artifact previews"
        >
          ✕
        </button>
      </div>

      <div className="flex gap-1 border-b border-border p-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`rounded-md px-2.5 py-1 text-[13px] ${
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
