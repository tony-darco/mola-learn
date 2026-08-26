/**
 * Agent C — retrieval agent tests (§6).
 *
 * Covers: each of the three tools independently, the degradation path (a
 * document mid-pipeline must produce a clear "not indexed" signal and a
 * grep/BM25 fallback rather than a guess or a silent omission), that
 * vector_search embeds with kind: "query" (contract 3's asymmetry), tool
 * registration through the real ToolRegistry, and the Layer 3 pointer catalog
 * extension.
 *
 * Requires the local stack (`pnpm up && pnpm db:migrate && pnpm db:seed`).
 * No live Ollama call — SelfHostedEmbeddingProvider is mocked so this suite
 * runs without a reachable embedding host, unlike the golden-set harness.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { chats, courses, db, users } from "@mola/db";
import { EMBEDDING, type EmbeddingKind } from "@mola/shared";
import type { EmbeddingProvider } from "../lib/llm/types";
import { SelfHostedEmbeddingProvider } from "../lib/llm";
import { seedTestDocument } from "../lib/agent/retrieval/test-fixtures";
import { grepSearchTool } from "../lib/agent/tools/grep-search";
import { bm25SearchTool } from "../lib/agent/tools/bm25-search";
import { vectorSearchTool } from "../lib/agent/tools/vector-search";
import { buildRegistry, RETRIEVAL_TOOL_NAMES } from "../lib/agent/tools";
import { assembleContext } from "../lib/context/assemble";
import type { ToolContext } from "../lib/agent/registry";

const FIXED_VECTOR = Array(EMBEDDING.dim).fill(0.01);

/** Deterministic stand-in for the real embedder — no network call. */
class FixedEmbeddingProvider implements EmbeddingProvider {
  readonly id = "fixed-test";
  readonly model = EMBEDDING.model;
  readonly dim = EMBEDDING.dim;
  async embed(texts: string[], _kind: EmbeddingKind): Promise<number[][]> {
    return texts.map(() => FIXED_VECTOR);
  }
}

let alice: { id: string };
let chatId: string;
let testCourseId: string;
let ctx: ToolContext;

beforeAll(async () => {
  const [a] = await db.select().from(users).where(eq(users.email, "alice@umbc.edu"));
  if (!a) throw new Error("run `pnpm db:seed` first");
  alice = a;

  const [chat] = await db.select().from(chats).where(eq(chats.userId, alice.id)).limit(1);
  if (!chat) throw new Error("run `pnpm db:seed` first");
  chatId = chat.id;

  const [course] = await db
    .insert(courses)
    .values({ userId: alice.id, name: "Agent C retrieval test course" })
    .returning();
  testCourseId = course!.id;

  ctx = { session: { userId: alice.id, email: "alice@umbc.edu" }, chatId, courseId: testCourseId };
});

afterAll(async () => {
  // Cascades to documents → document_chunks.
  await db.delete(courses).where(eq(courses.id, testCourseId));
});

describe("tool: grep_search", () => {
  it("finds an exact literal substring", async () => {
    await seedTestDocument({
      userId: alice.id,
      courseId: testCourseId,
      kind: "syllabus",
      title: "Grep Fixture Doc",
      status: "extracting",
      chunks: ["The office hours are held in ITE-411A-GREPMARK every Tuesday."],
    });

    const result = (await grepSearchTool.execute({ pattern: "ITE-411A-GREPMARK" }, ctx)) as string;
    expect(result).toContain("ITE-411A-GREPMARK");
    expect(result).toContain("Grep Fixture Doc");
  });

  it("reports no hits rather than throwing when nothing matches", async () => {
    const result = (await grepSearchTool.execute({ pattern: "NO-SUCH-TOKEN-XYZ" }, ctx)) as string;
    expect(result).toMatch(/no chunks found/i);
  });
});

describe("tool: bm25_search", () => {
  it("ranks by keyword relevance", async () => {
    await seedTestDocument({
      userId: alice.id,
      courseId: testCourseId,
      kind: "textbook",
      title: "BM25 Fixture Doc",
      status: "extracting",
      chunks: [
        "Thrashing occurs when the working set BM25KEYWORDMARK exceeds available frames.",
        "This paragraph is about unrelated scheduling policies and has nothing to do with it.",
      ],
    });

    const result = (await bm25SearchTool.execute({ query: "BM25KEYWORDMARK working set" }, ctx)) as string;
    expect(result).toContain("BM25KEYWORDMARK");
    expect(result).toContain("BM25 Fixture Doc");
  });
});

describe("tool: vector_search", () => {
  it("searches ready documents and returns the nearest chunk", async () => {
    await seedTestDocument({
      userId: alice.id,
      courseId: testCourseId,
      kind: "textbook",
      title: "Vector Fixture Doc",
      status: "ready",
      chunks: ["A chunk about VECTORSEARCHMARK semantic retrieval."],
      embedder: new FixedEmbeddingProvider(),
    });

    vi.spyOn(SelfHostedEmbeddingProvider.prototype, "embed").mockResolvedValue([FIXED_VECTOR]);
    try {
      const result = (await vectorSearchTool.execute({ query: "tell me about vector search" }, ctx)) as string;
      expect(result).toContain("VECTORSEARCHMARK");
      expect(result).toContain("Vector Fixture Doc");
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("embeds the query with kind: 'query' (contract 3 asymmetry)", async () => {
    const spy = vi.spyOn(SelfHostedEmbeddingProvider.prototype, "embed").mockResolvedValue([FIXED_VECTOR]);
    try {
      await vectorSearchTool.execute({ query: "some question" }, ctx);
      expect(spy).toHaveBeenCalledWith(["some question"], "query");
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("degradation path — a document mid-pipeline is never guessed on (§6)", () => {
  it("vector_search gives a clear not-indexed signal, distinct from an empty result", async () => {
    const isolatedCourse = (
      await db.insert(courses).values({ userId: alice.id, name: "Isolated degrade-path course" }).returning()
    )[0]!;
    const isolatedCtx: ToolContext = { ...ctx, courseId: isolatedCourse.id };

    await seedTestDocument({
      userId: alice.id,
      courseId: isolatedCourse.id,
      kind: "lecture_transcript",
      title: "Mid-Pipeline Doc",
      status: "extracting", // extracted, chunked — NOT embedded yet
      chunks: ["A fact about DEGRADEPATHMARK that only grep/BM25 can reach right now."],
    });

    try {
      const vectorResult = (await vectorSearchTool.execute({ query: "degrade path mark" }, isolatedCtx)) as string;
      expect(vectorResult).toMatch(/not indexed/i);
      expect(vectorResult).toContain("Mid-Pipeline Doc");
      expect(vectorResult).toContain("extracting");
      expect(vectorResult).toMatch(/grep_search|bm25_search/);

      // The chunk still exists and is grep/BM25-searchable (§1: "a chunk is
      // grep/BM25-searchable from extraction; the vector lands later, async").
      const grepResult = (await grepSearchTool.execute({ pattern: "DEGRADEPATHMARK" }, isolatedCtx)) as string;
      expect(grepResult).toContain("DEGRADEPATHMARK");

      const bm25Result = (await bm25SearchTool.execute({ query: "DEGRADEPATHMARK" }, isolatedCtx)) as string;
      expect(bm25Result).toContain("DEGRADEPATHMARK");
    } finally {
      await db.delete(courses).where(eq(courses.id, isolatedCourse.id));
    }
  });
});

describe("tool registration through the real ToolRegistry (contract 4)", () => {
  it("registers all three retrieval tools in the catalog", () => {
    const names = buildRegistry().catalog().map((t) => t.name);
    for (const n of RETRIEVAL_TOOL_NAMES) expect(names).toContain(n);
  });

  it("the retrieval allowlist resolves to a valid sub-agent tool subset", () => {
    expect(() => buildRegistry().subset(RETRIEVAL_TOOL_NAMES)).not.toThrow();
  });

  it("generates JSON Schema for each retrieval tool's input", () => {
    const specs = buildRegistry().specs();
    for (const n of RETRIEVAL_TOOL_NAMES) {
      const spec = specs.find((s) => s.name === n);
      expect(spec?.parameters).toMatchObject({ type: "object" });
    }
  });
});

describe("Layer 3 pointer catalog extension (§5, §7)", () => {
  it("surfaces a document's pointer one-liner without the full pointer content", async () => {
    const pointerMd = [
      "# Operating Systems Notes — Lecture 4",
      "",
      "Covers virtual memory and page replacement algorithms.",
      "",
      "## Foreword",
      "This is a much longer foreword paragraph that must never reach layer 3 " +
        "in full because the pointer file is a summary artifact, not the document.",
    ].join("\n");

    await seedTestDocument({
      userId: alice.id,
      courseId: testCourseId,
      kind: "lecture_transcript",
      title: "Pointer Fixture Doc",
      status: "indexing",
      chunks: ["irrelevant chunk text"],
      pointerMd,
    });

    const assembled = await assembleContext({
      userId: alice.id,
      chatId,
      courseId: testCourseId,
      tools: buildRegistry(),
      hintRung: null,
    });

    expect(assembled.layers.catalog).toContain("Pointer Fixture Doc");
    expect(assembled.layers.catalog).toContain("Covers virtual memory and page replacement algorithms.");
    expect(assembled.layers.catalog).not.toContain("much longer foreword paragraph");
  });

  it("handles a null pointer_md without crashing (Agent B hasn't populated it yet)", async () => {
    await seedTestDocument({
      userId: alice.id,
      courseId: testCourseId,
      kind: "student_notes",
      title: "No Pointer Yet Doc",
      status: "scanning",
      chunks: ["irrelevant"],
    });

    const assembled = await assembleContext({
      userId: alice.id,
      chatId,
      courseId: testCourseId,
      tools: buildRegistry(),
      hintRung: null,
    });

    expect(assembled.layers.catalog).toContain("No Pointer Yet Doc");
    expect(assembled.layers.catalog).toContain("status: scanning");
  });
});
