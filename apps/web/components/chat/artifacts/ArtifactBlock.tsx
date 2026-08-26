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
    <div className="artifact-block">
      <div className="artifact-block-title">
        <span className="artifact-block-icon">{artifactIcon(artifact.payload.kind)}</span>
        <span>{artifact.title}</span>
        <span className="artifact-block-summary">{summarizeArtifact(artifact.payload)}</span>
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
