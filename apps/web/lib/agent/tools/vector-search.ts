/**
 * Tool 3 of the retrieval agent (§6) — vector similarity over pgvector
 * (HNSW, cosine). Only ever searches chunks whose parent document is `ready`.
 *
 * The status rule (§6, CONTRACTS.md "rules that are not interfaces"): a
 * document mid-pipeline is not silently treated as absent, and it is not
 * silently treated as searchable either. When nothing in scope is ready this
 * returns a clear "not indexed" signal instead of an empty result that would
 * be indistinguishable from "searched and found nothing" — the agent is
 * expected to fall back to grep_search / bm25_search and say so, never guess.
 *
 * CRITICAL (contract 3, embedding asymmetry): this is the QUERY side —
 * `embed([query], "query")` applies the Instruct/Query prefix. Uses
 * SelfHostedEmbeddingProvider directly; never Ollama directly, and never a
 * user's BYOK key (that path has no `embed` method at all — contract 3).
 */
import { z } from "zod";
import { vectorSearch } from "../retrieval/queries";
import { formatPendingNote } from "../retrieval/status";
import { formatHits } from "../retrieval/format";
import { SelfHostedEmbeddingProvider } from "../../llm";
import type { Tool } from "../registry";

const inputSchema = z.object({
  query: z.string().min(1).describe("Natural-language question to search for by meaning, not exact words"),
  limit: z.number().int().min(1).max(20).optional().describe("Max chunks to return (default 10)"),
});

export const vectorSearchTool: Tool<z.infer<typeof inputSchema>> = {
  name: "vector_search",
  description:
    "Search the student's course documents by semantic similarity. Only works on documents that are fully indexed (status: ready); otherwise returns a not-indexed signal.",
  inputSchema,
  label: (input) => `Semantic search: "${input.query}"`,

  async execute(input, ctx) {
    const embedder = new SelfHostedEmbeddingProvider();
    const result = await vectorSearch(
      input.query,
      { userId: ctx.session.userId, courseId: ctx.courseId, limit: input.limit },
      embedder,
    );

    if (!result.indexed) {
      const pendingNote = formatPendingNote(result.pending);
      return (
        `not indexed: no documents in scope are fully embedded yet.` +
        (pendingNote ? ` ${pendingNote}` : " No documents are uploaded for this scope.") +
        ` Use grep_search or bm25_search instead — do not guess.`
      );
    }

    const body = formatHits(result.hits, `semantic match for "${input.query}"`);
    const pendingNote = formatPendingNote(result.pending);
    return pendingNote ? `${body}\n\n${pendingNote}` : body;
  },
};
