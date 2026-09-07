/**
 * tiered-search.ts — the shared textbook-tree -> chunks -> vector fallback
 * used by grep_search/bm25_search on behalf of every course-document
 * consumer. Tests the tier boundaries directly against tieredGrep/tieredBm25
 * (plain functions) rather than through a live LLM, with an explicit
 * minResults override per test so each fixture only needs to model exactly
 * the boundary it's proving.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { courses, db, documents, textbookChapters, users } from "@mola/db";
import { EMBEDDING, type EmbeddingKind } from "@mola/shared";
import type { EmbeddingProvider } from "../lib/llm/types";
import { tieredGrep } from "../lib/agent/retrieval/tiered-search";
import { seedTestDocument } from "../lib/agent/retrieval/test-fixtures";

const FIXED_VECTOR = Array(EMBEDDING.dim).fill(0.02);

/** Same vector for every text — deterministic, no network call. */
class FixedEmbeddingProvider implements EmbeddingProvider {
  readonly id = "fixed-test";
  readonly model = EMBEDDING.model;
  readonly dim = EMBEDDING.dim;
  calls = 0;
  async embed(texts: string[], _kind: EmbeddingKind): Promise<number[][]> {
    this.calls += 1;
    return texts.map(() => FIXED_VECTOR);
  }
}

let alice: { id: string };
let courseId: string;

beforeEach(async () => {
  const [a] = await db.select().from(users).where(eq(users.email, "alice@umbc.edu"));
  if (!a) throw new Error("run `pnpm db:seed` first");
  alice = a;

  const [course] = await db
    .insert(courses)
    .values({ userId: alice.id, name: "Tiered search test course" })
    .returning();
  courseId = course!.id;
});

afterEach(async () => {
  await db.delete(courses).where(eq(courses.id, courseId));
});

async function seedChapter(title: string, markdown: string, ordinal = 0) {
  const [doc] = await db
    .insert(documents)
    .values({
      userId: alice.id,
      courseId,
      kind: "textbook",
      title: `Textbook for ${title}`,
      s3KeyRaw: `test-fixture/${title}`,
      status: "ready",
    })
    .returning();

  await db.insert(textbookChapters).values({
    userId: alice.id,
    documentId: doc!.id,
    ordinal,
    chapterNumber: ordinal + 1,
    title,
    markdown,
    status: "ready",
  });
}

describe("tieredGrep tier boundaries", () => {
  it("stops at the textbook tree when it alone meets minResults", async () => {
    await seedChapter("Chapter One", "This chapter covers TREETIERMARK in depth.", 0);
    await seedChapter("Chapter Two", "TREETIERMARK also appears here as a callback.", 1);

    const scope = { userId: alice.id, courseId };
    const result = await tieredGrep("TREETIERMARK", scope, new FixedEmbeddingProvider(), { minResults: 2 });

    expect(result.tier).toBe("textbook_tree");
    expect(result.hits).toHaveLength(2);
    expect(result.hits.every((h) => h.locator?.startsWith("ch."))).toBe(true);
  });

  it("falls back to document_chunks when the tree is thin", async () => {
    await seedTestDocument({
      userId: alice.id,
      courseId,
      kind: "student_notes",
      title: "Chunk Fixture",
      status: "extracting",
      chunks: ["A note mentioning CHUNKTIERMARK once.", "Another note about CHUNKTIERMARK too."],
    });

    const scope = { userId: alice.id, courseId };
    const result = await tieredGrep("CHUNKTIERMARK", scope, new FixedEmbeddingProvider(), { minResults: 2 });

    expect(result.tier).toBe("chunks");
    expect(result.hits.length).toBeGreaterThanOrEqual(2);
    expect(result.hits.some((h) => h.text.includes("CHUNKTIERMARK"))).toBe(true);
  });

  it("escalates to vector search when both lexical tiers stay thin", async () => {
    await seedChapter("Chapter One", "VECTORTIERMARK is mentioned once here.", 0);
    await seedTestDocument({
      userId: alice.id,
      courseId,
      kind: "student_notes",
      title: "Thin Chunk Fixture",
      status: "extracting",
      chunks: ["Also VECTORTIERMARK shows up in a note."],
    });

    const embedder = new FixedEmbeddingProvider();
    await seedTestDocument({
      userId: alice.id,
      courseId,
      kind: "textbook",
      title: "Ready Vector Fixture",
      status: "ready",
      chunks: ["Semantically related content the vector tier should surface."],
      embedder,
    });

    const scope = { userId: alice.id, courseId };
    const result = await tieredGrep("VECTORTIERMARK", scope, embedder, { minResults: 3 });

    expect(result.tier).toBe("vector");
    expect(embedder.calls).toBeGreaterThan(0);
    // The two thin lexical hits plus at least one vector hit.
    expect(result.hits.length).toBeGreaterThanOrEqual(3);
  });
});
