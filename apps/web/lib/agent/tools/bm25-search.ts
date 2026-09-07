/**
 * Tool 2 of the retrieval agent (§6) — BM25-style keyword relevance via
 * Postgres full-text search (ts_rank_cd over the generated tsvector index).
 * Strong on exact tokens, weak on paraphrase — the opposite failure mode of
 * vector_search (evals/golden/RESULTS.md).
 *
 * Backed by tiered-search.ts's shared strategy: textbook chapter tree first,
 * then raw document chunks, then pgvector as a last resort — all inside this
 * one tool call, so every consumer that already imports bm25SearchTool
 * (main chat, mind maps, quizzes, flashcards) gets the tiering for free.
 */
import { z } from "zod";
import { SelfHostedEmbeddingProvider } from "../../llm";
import type { Tool } from "../registry";
import { formatTieredResult, tieredBm25 } from "../retrieval/tiered-search";

const inputSchema = z.object({
  query: z.string().min(1).describe("Keywords to rank document chunks by lexical relevance"),
  limit: z.number().int().min(1).max(20).optional().describe("Max chunks to return (default 10)"),
});

export const bm25SearchTool: Tool<z.infer<typeof inputSchema>> = {
  name: "bm25_search",
  description:
    "Rank the student's course documents by keyword relevance (BM25). Strong on exact terms, weak on paraphrased questions.",
  inputSchema,
  label: (input) => `Keyword search: "${input.query}"`,

  async execute(input, ctx) {
    const embedder = new SelfHostedEmbeddingProvider();
    const result = await tieredBm25(
      input.query,
      { userId: ctx.session.userId, courseId: ctx.courseId, limit: input.limit },
      embedder,
      { minResults: ctx.retrievalMinResults },
    );
    return formatTieredResult(result, `keyword relevance for "${input.query}"`);
  },
};
