/**
 * CONTRACT 3 (partial) — the single source of truth for the embedding model.
 *
 * Imported by the Drizzle schema (packages/db) and read by the Python ingest
 * worker from the same env config, so the two sides cannot drift.
 *
 * RESOLVED (plan item S1.4): Qwen3-Embedding 0.6B at its native 1024 dims.
 *
 * The 4B and 8B variants in this family are deliberately NOT used. Embedding
 * quality saturates early — 0.6B scores within a fraction of 8B on English
 * retrieval — while 8B's 4096 dims would quadruple per-chunk storage, index
 * build time, index memory and per-comparison arithmetic on RDS for a delta
 * not measurable at pilot scale. If retrieval quality later proves limiting,
 * the fix is a RERANKER over the top-50 candidates (qwen3-reranker, same
 * family, two-stage) — not a wider embedder, and not a re-embed. That is a
 * Phase 2 addition with no schema commitment.
 */

export const EMBEDDING = {
  model: "qwen3-embedding:0.6b",
  dim: 1024,
  version: 1,
} as const;

/**
 * Qwen3-Embedding is INSTRUCTION-AWARE and ASYMMETRIC:
 *
 *   - stored document chunks are embedded raw, with no prefix
 *   - queries are prefixed with `Instruct: <task>\nQuery: <text>`
 *
 * Getting this wrong FAILS SILENTLY — nothing throws, retrieval just gets worse.
 * That is why the asymmetry lives inside EmbeddingProvider behind an explicit
 * `kind` argument rather than at agent level: Agents B and C work in separate
 * worktrees, and if each owned this independently they could get it wrong
 * independently and neither would notice.
 *
 * Honest caveat: the Phase 0 golden set could NOT measure a benefit from the
 * prefix on a syllabus corpus (19/20 vs 20/20 @5 — noise at n=20). It is kept
 * because it is the documented usage for this family and because a syllabus is
 * an easy corpus; the case it should help is a textbook explaining a concept in
 * words the student would not have used. See evals/golden/RESULTS.md before
 * treating this as settled either way.
 *
 * Both sides read this one string. Changing it changes query embeddings only —
 * stored vectors are unaffected, so it needs no re-embed and no version bump.
 */
export const EMBEDDING_TASK =
  "Given a student's question about their course material, retrieve the passages " +
  "from textbooks, lecture transcripts and personal notes that answer it";

export type EmbeddingKind = "query" | "document";

/** The exact text handed to the model. The ONE place the asymmetry is applied. */
export function formatForEmbedding(text: string, kind: EmbeddingKind): string {
  return kind === "query" ? `Instruct: ${EMBEDDING_TASK}\nQuery: ${text}` : text;
}
