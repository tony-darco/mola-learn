/**
 * CONTRACT 3 — the model abstraction. FROZEN.
 *
 * Two interfaces, deliberately split. This split IS the enforcement mechanism
 * described in the plan (S1): the BYOK path has no `embed` method, so no agent
 * can route ingest embeddings through a student's key by accident.
 *
 * No provider SDK is imported anywhere outside lib/llm/.
 */
import type { EmbeddingKind, ProviderStreamEvent } from "@mola/shared";

export type Message = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: { id: string; name: string; input: unknown }[];
};

export type ToolSpec = {
  name: string;
  description: string;
  /** JSON Schema, derived from the tool's zod inputSchema by the registry. */
  parameters: Record<string, unknown>;
};

export type CompletionRequest = {
  system: string;
  messages: Message[];
  tools?: ToolSpec[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
};

/** Chat completions. BYOK — the student's key, the student's provider choice. */
export interface LLMProvider {
  readonly id: string;
  stream(req: CompletionRequest): AsyncIterable<ProviderStreamEvent>;
}

/**
 * Embeddings. PLATFORM-OWNED and fixed to one self-hosted model.
 *
 * Never selectable per user. Two reasons (see plan S1): a per-user model choice
 * would silently invalidate that student's own index, since vector width differs
 * across providers; and routing ingest through a student's key would bill them
 * for a 400-chunk textbook ingest they did not initiate. Self-hosted also keeps
 * other students' coursework inside the VPC, which matters because FERPA is a
 * named ship-killer.
 */
export interface EmbeddingProvider {
  readonly id: string;
  readonly model: string;
  readonly dim: number;

  /**
   * `kind` is REQUIRED and has no default, deliberately.
   *
   * Qwen3-Embedding is asymmetric: queries carry a task-instruction prefix,
   * stored documents do not. Getting it wrong degrades retrieval measurably and
   * fails silently. Forcing the caller to name the side makes that impossible to
   * omit by accident — Agents B ("document") and C ("query") each state it.
   */
  embed(texts: string[], kind: EmbeddingKind): Promise<number[][]>;
}
