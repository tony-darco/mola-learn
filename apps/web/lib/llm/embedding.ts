/**
 * The platform-owned embedding provider (contract 3).
 *
 * Never selectable per user, and never reachable from a BYOK key — the split in
 * types.ts is what enforces that structurally.
 */
import { EMBEDDING, formatForEmbedding, type EmbeddingKind } from "@mola/shared";
import type { EmbeddingProvider } from "./types";

const HOST = process.env.OLLAMA_HOST ?? "http://192.168.1.17:11434";

/**
 * Total timeout. Unlike chat this is a single non-streaming request over a
 * bounded batch, so a duration cap is the right shape. Without it a stalled
 * host blocks an ingest worker indefinitely — the job never fails, never
 * retries, and the document sits in `indexing` forever.
 */
const EMBED_TIMEOUT_MS = Number(process.env.OLLAMA_EMBED_TIMEOUT_MS ?? 300_000);

export class SelfHostedEmbeddingProvider implements EmbeddingProvider {
  readonly id = "self-hosted";
  readonly model = EMBEDDING.model;
  readonly dim = EMBEDDING.dim;

  async embed(texts: string[], kind: EmbeddingKind): Promise<number[][]> {
    if (texts.length === 0) return [];

    const res = await fetch(`${HOST}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
      body: JSON.stringify({
        model: this.model,
        input: texts.map((t) => formatForEmbedding(t, kind)),
        // CPU-only, explicitly. Ingestion is batch and offline and must never
        // contend with the chat model for VRAM.
        options: { num_gpu: 0 },
      }),
    });
    if (!res.ok) throw new Error(`embed failed: ${res.status} ${await res.text()}`);

    const { embeddings } = (await res.json()) as { embeddings: number[][] };

    // Guards against a model swap that silently changes width — the one failure
    // that would corrupt the index rather than error.
    for (const v of embeddings) {
      if (v.length !== this.dim) {
        throw new Error(
          `embedding width mismatch: ${this.model} returned ${v.length}, ` +
            `EMBEDDING.dim is ${this.dim}`,
        );
      }
    }
    return embeddings;
  }
}
