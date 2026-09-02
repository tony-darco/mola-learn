"use client";

import type { ArtifactRecord } from "@mola/shared";
import { artifactIcon, summarizeArtifact } from "../artifact-summary";
import { FlashcardDeck } from "./FlashcardDeck";
import { Quiz } from "./Quiz";
import { MindMap } from "./MindMap";

/**
 * Renders a real interface per artifact kind — never a JSON dump. Dispatches
 * on the frozen discriminated union (contract 6); a kind this switch doesn't
 * know about is a type error, not a silent fallthrough.
 */
export function ArtifactBlock({ artifact }: { artifact: ArtifactRecord }) {
  return (
    <div className="mt-3 rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center gap-2 font-semibold text-fg">
        <span className="text-base">{artifactIcon(artifact.payload.kind)}</span>
        <span>{artifact.title}</span>
        <span className="ml-auto text-xs font-normal text-fg-muted">{summarizeArtifact(artifact.payload)}</span>
      </div>
      {renderPayload(artifact)}
    </div>
  );
}

function renderPayload(artifact: ArtifactRecord) {
  switch (artifact.payload.kind) {
    case "flashcard_deck":
      return <FlashcardDeck payload={artifact.payload} title={artifact.title} />;
    case "quiz":
      return <Quiz payload={artifact.payload} title={artifact.title} />;
    case "mind_map":
      return <MindMap payload={artifact.payload} title={artifact.title} />;
    default: {
      const _exhaustive: never = artifact.payload;
      return _exhaustive;
    }
  }
}
