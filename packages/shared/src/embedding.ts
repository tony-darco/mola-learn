/**
 * CONTRACT 3 (partial) — the single source of truth for the embedding model.
 *
 * Imported by the Drizzle schema (packages/db) and read by the Python ingest
 * worker from the same env config, so the two sides cannot drift.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ ⚠ BLOCKED — DECISION FOR TONY (plan item S1.4)                          │
 * │                                                                         │
 * │ `dim` is PERMANENT once the first migration containing the embedding    │
 * │ column is applied. It is deliberately null until a benchmark of 2–3      │
 * │ candidates against ~20 real syllabus questions has been run.             │
 * │                                                                         │
 * │   nomic-embed-text   768   (already pulled locally; 274MB, CPU-viable)  │
 * │   mxbai-embed-large 1024                                                │
 * │   bge-m3            1024                                                │
 * │                                                                         │
 * │ Nothing else in the codebase is blocked on this. The Phase 0 thin slice │
 * │ never touches an embedding; the first consumers are Agent B (writes)    │
 * │ and Agent C (reads), both in Phase 1.                                   │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

export type EmbeddingConfig = {
  /** Ollama model tag, e.g. "nomic-embed-text". */
  model: string | null;
  /** Vector width. Permanent once migrated. Null until S1.4 is decided. */
  dim: number | null;
  /**
   * Bumped whenever the model changes, so `document_chunks.embedding_version`
   * can identify which rows need backfilling. See the migration path in the plan.
   */
  version: number;
};

export const EMBEDDING: EmbeddingConfig = {
  model: null,
  dim: null,
  version: 1,
};

/**
 * Fail-loud accessor. Any code path that needs a concrete dimension must go
 * through this rather than reading `EMBEDDING.dim` directly, so an unresolved
 * S1.4 surfaces as an explicit error instead of a `vector(null)` migration or
 * a silently mis-sized column.
 */
export function requireEmbeddingConfig(): { model: string; dim: number; version: number } {
  if (EMBEDDING.model === null || EMBEDDING.dim === null) {
    throw new Error(
      "EMBEDDING is not yet frozen (plan item S1.4). Run the embedding benchmark " +
        "and set model + dim in packages/shared/src/embedding.ts before generating " +
        "the migration that adds document_chunks.embedding.",
    );
  }
  return { model: EMBEDDING.model, dim: EMBEDDING.dim, version: EMBEDDING.version };
}

/** Whether the embedding decision has landed. Lets callers degrade rather than throw. */
export const isEmbeddingFrozen = (): boolean =>
  EMBEDDING.model !== null && EMBEDDING.dim !== null;
