/**
 * Tool 1 of the retrieval agent (§6) — grep-style literal substring search.
 * Async, no embeddings required: works the moment a document is extracted,
 * regardless of embedding status.
 *
 * Backed by tiered-search.ts's shared strategy: textbook chapter tree first,
 * then raw document chunks, then pgvector as a last resort — all inside this
 * one tool call, so every consumer that already imports grepSearchTool
 * (main chat, mind maps, quizzes, flashcards) gets the tiering for free.
 */
import { z } from "zod";
import { SelfHostedEmbeddingProvider } from "../../llm";
import type { Tool } from "../registry";
import { formatTieredResult, tieredGrep } from "../retrieval/tiered-search";

const inputSchema = z.object({
  pattern: z.string().min(1).describe("Exact literal substring or phrase to find verbatim in document text"),
  limit: z.number().int().min(1).max(20).optional().describe("Max chunks to return (default 10)"),
});

export const grepSearchTool: Tool<z.infer<typeof inputSchema>> = {
  name: "grep_search",
  description:
    "Find an exact literal substring or phrase in the student's course documents (names, codes, dates). No ranking model.",
  inputSchema,
  label: (input) => `Grep search: "${input.pattern}"`,

  async execute(input, ctx) {
    const embedder = new SelfHostedEmbeddingProvider();
    const result = await tieredGrep(
      input.pattern,
      { userId: ctx.session.userId, courseId: ctx.courseId, limit: input.limit },
      embedder,
      { minResults: ctx.retrievalMinResults },
    );
    return formatTieredResult(result, `literal match for "${input.pattern}"`);
  },
};
