/**
 * The platform-owned embedding provider (contract 3).
 *
 * Constructing this THROWS while S1.4 is unresolved, by design: a
 * silently-wrong vector width is far more expensive to discover later than a
 * loud failure now. Phase 1 agents B and C are the first real consumers.
 */
import { requireEmbeddingConfig } from "@mola/shared";
import type { EmbeddingProvider } from "./types";

const HOST = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";

export class SelfHostedEmbeddingProvider implements EmbeddingProvider {
  readonly id = "self-hosted";
  readonly model: string;
  readonly dim: number;

  constructor() {
    const cfg = requireEmbeddingConfig();
    this.model = cfg.model;
    this.dim = cfg.dim;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch(`${HOST}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) throw new Error(`embed failed: ${res.status} ${await res.text()}`);

    const { embeddings } = (await res.json()) as { embeddings: number[][] };
    for (const v of embeddings) {
      if (v.length !== this.dim) {
        throw new Error(
          `embedding width mismatch: model returned ${v.length}, EMBEDDING.dim is ${this.dim}`,
        );
      }
    }
    return embeddings;
  }
}
