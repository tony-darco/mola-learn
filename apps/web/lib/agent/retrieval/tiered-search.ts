/**
 * The one shared retrieval-fallback strategy: textbook chapter tree -> raw
 * document chunks -> pgvector. Every course-document consumer (main chat,
 * mind maps, quizzes, flashcards) reaches this through the SAME grep_search/
 * bm25_search tools (tools/grep-search.ts, tools/bm25-search.ts) — those
 * tool objects are imported by reference into every consumer's registry, so
 * upgrading what they call here covers all of them in one change, with no
 * per-consumer tool or prompt changes required.
 *
 * Previously this ordering lived only as prose, copy-pasted into each
 * consumer's own system prompt ("try grep/bm25 first, fall back to
 * vector_search") — the model decided tiering, re-specified four times. This
 * module makes it one code path with one tunable sufficiency threshold.
 *
 * Explicitly NOT used by the chat-search agent (grep-chat-search.ts /
 * bm25-chat-search.ts) — that searches messages/compactionBoundaries, a
 * different index and a different retrieval surface entirely.
 */
import type { EmbeddingProvider } from "../../llm/types";
import { formatHits } from "./format";
import { bm25Search, grepSearch, vectorSearch, type ChunkHit, type SearchScope } from "./queries";
import { formatPendingNote } from "./status";
import { bm25TextbookTree, grepTextbookTree } from "./textbook-queries";

/** A handful of hits is "enough" for one mind-map node or one chat turn — see quizzes.ts for a consumer that raises this. */
export const DEFAULT_MIN_RESULTS = 3;

export type TieredSearchResult = {
  hits: ChunkHit[];
  /** Which tier the final result set bottomed out at — for logging/debugging, not shown to the model. */
  tier: "textbook_tree" | "chunks" | "vector";
  pendingNote: string | null;
};

type Mode = "grep" | "bm25";

async function tieredSearch(
  mode: Mode,
  text: string,
  scope: SearchScope,
  embedder: EmbeddingProvider,
  opts?: { minResults?: number },
): Promise<TieredSearchResult> {
  const minResults = opts?.minResults ?? DEFAULT_MIN_RESULTS;
  const searchTree = mode === "grep" ? grepTextbookTree : bm25TextbookTree;
  const searchChunks = mode === "grep" ? grepSearch : bm25Search;

  const treeHits = await searchTree(text, scope);
  if (treeHits.length >= minResults) {
    return { hits: treeHits, tier: "textbook_tree", pendingNote: null };
  }

  const chunkHits = await searchChunks(text, scope);
  const combined = [...treeHits, ...chunkHits];
  if (combined.length >= minResults) {
    return { hits: combined, tier: "chunks", pendingNote: null };
  }

  // Final tier: pgvector. `text` here is whatever the caller passed to grep
  // or bm25 (a literal pattern, for grep) rather than a natural-language
  // question — not ideal as a semantic query, but strictly better than
  // returning nothing once the lexical tiers have already come up thin.
  const vectorResult = await vectorSearch(text, scope, embedder);
  if (!vectorResult.indexed) {
    return { hits: combined, tier: "vector", pendingNote: formatPendingNote(vectorResult.pending) };
  }
  return {
    hits: [...combined, ...vectorResult.hits],
    tier: "vector",
    pendingNote: formatPendingNote(vectorResult.pending),
  };
}

export function tieredGrep(
  pattern: string,
  scope: SearchScope,
  embedder: EmbeddingProvider,
  opts?: { minResults?: number },
): Promise<TieredSearchResult> {
  return tieredSearch("grep", pattern, scope, embedder, opts);
}

export function tieredBm25(
  query: string,
  scope: SearchScope,
  embedder: EmbeddingProvider,
  opts?: { minResults?: number },
): Promise<TieredSearchResult> {
  return tieredSearch("bm25", query, scope, embedder, opts);
}

export function formatTieredResult(result: TieredSearchResult, describedAs: string): string {
  const body = formatHits(result.hits, describedAs);
  return result.pendingNote ? `${body}\n\n${result.pendingNote}` : body;
}
