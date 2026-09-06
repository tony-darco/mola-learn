/**
 * Chat search agent (§6) — grep-style literal substring search over the
 * student's own past conversations. Mirrors tools/grep-search.ts, but over
 * chat turns + compaction summaries instead of document chunks.
 *
 * Registered as a flat tool on buildRegistry() (see tools/index.ts), same as
 * grep_search / bm25_search / vector_search: the live chat path calls these
 * directly rather than through a spun-up sub-agent (runSubagent is only
 * exercised by the retrieval eval harness, not live traffic).
 */
import { z } from "zod";
import { grepChats } from "../chat-search/queries";
import type { Tool } from "../registry";
import { formatChatHits } from "../chat-search/format";

const inputSchema = z.object({
  pattern: z.string().min(1).describe("Exact literal substring or phrase to find verbatim in past chat turns"),
  limit: z.number().int().min(1).max(20).optional().describe("Max chat hits to return (default 10)"),
});

export const grepChatSearchTool: Tool<z.infer<typeof inputSchema>> = {
  name: "grep_chat_search",
  description:
    "Find an exact literal substring or phrase in the student's own past conversations (raw turns and compacted summaries). No ranking model.",
  inputSchema,
  label: (input) => `Grep chat search: "${input.pattern}"`,

  async execute(input, ctx) {
    const hits = await grepChats(input.pattern, {
      userId: ctx.session.userId,
      limit: input.limit,
    });
    return formatChatHits(hits, `literal match for "${input.pattern}"`);
  },
};
