/**
 * Tool 2 of the retrieval agent (§6) — BM25-style keyword relevance via
 * Postgres full-text search (ts_rank_cd over the generated tsvector index).
 * Strong on exact tokens, weak on paraphrase — the opposite failure mode of
 * vector_search (evals/golden/RESULTS.md).
 */
import { z } from "zod";
import { bm25Search } from "../retrieval/queries";
import type { Tool } from "../registry";
import { formatHits } from "../retrieval/format";

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
    const hits = await bm25Search(input.query, {
      userId: ctx.session.userId,
      courseId: ctx.courseId,
      limit: input.limit,
    });
    return formatHits(hits, `keyword relevance for "${input.query}"`);
  },
};
