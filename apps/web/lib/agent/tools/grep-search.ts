/**
 * Tool 1 of the retrieval agent (§6) — grep-style literal substring search.
 * Async, no embeddings required: works the moment a document is extracted,
 * regardless of embedding status.
 */
import { z } from "zod";
import { grepSearch } from "../retrieval/queries";
import type { Tool } from "../registry";
import { formatHits } from "../retrieval/format";

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
    const hits = await grepSearch(input.pattern, {
      userId: ctx.session.userId,
      courseId: ctx.courseId,
      limit: input.limit,
    });
    return formatHits(hits, `literal match for "${input.pattern}"`);
  },
};
