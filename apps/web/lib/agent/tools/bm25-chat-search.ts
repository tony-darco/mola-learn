/**
 * Chat search agent (§6) — BM25-style keyword relevance search (ts_rank_cd)
 * over the student's own past conversations. Mirrors tools/bm25-search.ts,
 * but over chat turns + compaction summaries instead of document chunks.
 *
 * No vector_search sibling here, deliberately (§6) — chat recall is a
 * literal lookup problem, not a paraphrase problem.
 *
 * Registered as a flat tool on buildRegistry() (see tools/index.ts), same as
 * grep_search / bm25_search / vector_search — see grep-chat-search.ts for why.
 */
import { z } from "zod";
import { bm25Chats } from "../chat-search/queries";
import type { Tool } from "../registry";
import { formatChatHits } from "../chat-search/format";

const inputSchema = z.object({
  query: z.string().min(1).describe("Keywords to rank the student's past chat turns by lexical relevance"),
  limit: z.number().int().min(1).max(20).optional().describe("Max chat hits to return (default 10)"),
});

export const bm25ChatSearchTool: Tool<z.infer<typeof inputSchema>> = {
  name: "bm25_chat_search",
  description:
    "Rank the student's own past conversations (raw turns and compacted summaries) by keyword relevance (BM25). Strong on exact terms, weak on paraphrased questions.",
  inputSchema,
  label: (input) => `Keyword chat search: "${input.query}"`,

  async execute(input, ctx) {
    const hits = await bm25Chats(input.query, {
      userId: ctx.session.userId,
      limit: input.limit,
    });
    return formatChatHits(hits, `keyword relevance for "${input.query}"`);
  },
};
