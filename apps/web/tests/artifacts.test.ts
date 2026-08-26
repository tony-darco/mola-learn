/**
 * Artifact rendering per kind (contract 6). No producing agent (E/G/H) exists
 * yet, so the fixtures in components/chat/fixtures.ts are what the renderers
 * are built and manually verified against — this test locks down that they
 * stay valid against the frozen schema, and that the per-kind summary line
 * used in the collapsed artifact header covers all three kinds correctly.
 */
import { describe, expect, it } from "vitest";
import { artifactRecordSchema } from "@mola/shared";
import { ARTIFACT_FIXTURES } from "../components/chat/fixtures";
import { artifactIcon, summarizeArtifact } from "../components/chat/artifact-summary";

describe("artifact fixtures", () => {
  it("covers all three frozen artifact kinds", () => {
    expect(ARTIFACT_FIXTURES.map((a) => a.kind).sort()).toEqual(
      ["flashcard_deck", "mind_map", "quiz"].sort(),
    );
  });

  it("each fixture round-trips through the frozen artifact schema", () => {
    for (const fixture of ARTIFACT_FIXTURES) {
      expect(() => artifactRecordSchema.parse(fixture)).not.toThrow();
    }
  });
});

describe("summarizeArtifact — per-kind collapsed header", () => {
  it("summarizes a flashcard deck by card count", () => {
    const deck = ARTIFACT_FIXTURES.find((a) => a.kind === "flashcard_deck")!;
    expect(summarizeArtifact(deck.payload)).toBe("3 cards");
  });

  it("summarizes a quiz by question count and difficulty", () => {
    const quiz = ARTIFACT_FIXTURES.find((a) => a.kind === "quiz")!;
    expect(summarizeArtifact(quiz.payload)).toBe("2 questions · standard");
  });

  it("summarizes a mind map by node count", () => {
    const map = ARTIFACT_FIXTURES.find((a) => a.kind === "mind_map")!;
    expect(summarizeArtifact(map.payload)).toBe("6 nodes");
  });

  it("singularizes a one-item deck", () => {
    expect(summarizeArtifact({ kind: "flashcard_deck", cards: [
      { id: "00000000-0000-4000-8000-000000000000", front: "f", back: "b", chapter: null, section: null, week: null },
    ] })).toBe("1 card");
  });

  it("returns a distinct icon per kind", () => {
    const icons = new Set(["flashcard_deck", "quiz", "mind_map"].map((k) => artifactIcon(k as never)));
    expect(icons.size).toBe(3);
  });
});
