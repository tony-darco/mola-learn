/**
 * Per-kind summary line for an artifact's collapsed/preview header. Pure and
 * exhaustive over ARTIFACT_KINDS so a new kind added to the frozen union
 * (packages/shared/src/artifacts.ts) is a compile error here, not a silent gap.
 */
import type { ArtifactPayload } from "@mola/shared";

export function summarizeArtifact(payload: ArtifactPayload): string {
  switch (payload.kind) {
    case "flashcard_deck":
      return `${payload.cards.length} card${payload.cards.length === 1 ? "" : "s"}`;
    case "quiz":
      return `${payload.questions.length} question${payload.questions.length === 1 ? "" : "s"} · ${payload.difficulty}`;
    case "mind_map":
      return `${payload.nodes.length} node${payload.nodes.length === 1 ? "" : "s"}`;
    default: {
      const _exhaustive: never = payload;
      return _exhaustive;
    }
  }
}

export function artifactIcon(kind: ArtifactPayload["kind"]): string {
  switch (kind) {
    case "flashcard_deck":
      return "🗂";
    case "quiz":
      return "📝";
    case "mind_map":
      return "🧠";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}
