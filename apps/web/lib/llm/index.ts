import { eq } from "drizzle-orm";
import { apiKeys, db } from "@mola/db";
import { decryptSecret } from "@/lib/auth/crypto";
import { DEFAULT_CHAT_MODEL, OllamaProvider } from "./ollama";
import { AnthropicProvider } from "./providers/anthropic";
import { OpenAIProvider } from "./providers/openai";
import type { CompletionRequest, LLMProvider } from "./types";
import type { ProviderStreamEvent } from "@mola/shared";

export * from "./types";
export { OllamaProvider, DEFAULT_CHAT_MODEL } from "./ollama";
export { CHAT_MODELS, modelSupportsThinking } from "./models";
export { SelfHostedEmbeddingProvider } from "./embedding";

/**
 * Model + thinking choice, threaded through provider construction rather than
 * CompletionRequest (contract 3, frozen — deliberately left untouched; see
 * MODEL-THINKING-PLAN.md). Only the Ollama branch below honors either field;
 * BYOK providers ignore both, since model selection is Ollama-only for now.
 */
export type ChatProviderOptions = { model?: string; think?: boolean };

/** Constructs a local OllamaProvider from model/think options — `OllamaProvider` itself also enforces the thinking-support clamp, so it's not solely relied on here. */
function ollamaProviderFor(opts?: ChatProviderOptions): OllamaProvider {
  return new OllamaProvider(opts?.model ?? DEFAULT_CHAT_MODEL, opts?.think ?? true);
}

async function resolveProvider(userId: string, opts?: ChatProviderOptions): Promise<LLMProvider> {
  const [key] = await db.select().from(apiKeys).where(eq(apiKeys.userId, userId)).limit(1);
  if (!key) return ollamaProviderFor(opts);

  const plaintext = decryptSecret({ ciphertext: key.ciphertext, iv: key.iv, authTag: key.authTag });
  switch (key.provider) {
    case "openai":
      return new OpenAIProvider(plaintext);
    case "anthropic":
      return new AnthropicProvider(plaintext);
    default:
      return ollamaProviderFor(opts);
  }
}

/**
 * Resolves to a user's BYOK provider when they've saved one, falling back to
 * the platform's Ollama default otherwise (§13, Settings). Phase 1 is still
 * "beta / testing" per the design doc's phasing table, so Ollama remaining the
 * default even after BYOK exists is deliberate, not a bug.
 *
 * The DB lookup + decrypt is unavoidably async, but `runAgentLoop` (contract 4,
 * frozen) and its callers construct `{ provider: getChatProvider(userId) }`
 * synchronously — so this stays synchronous too and defers the actual async
 * resolution to inside `stream()`, the one place it's already iterated with
 * `for await`. Callers never construct a provider directly either way.
 */
export function getChatProvider(userId: string, opts?: ChatProviderOptions): LLMProvider {
  return new LazyProvider(userId, opts);
}

class LazyProvider implements LLMProvider {
  readonly id = "byok-or-ollama";
  constructor(
    private readonly userId: string,
    private readonly opts?: ChatProviderOptions,
  ) {}

  async *stream(req: CompletionRequest): AsyncIterable<ProviderStreamEvent> {
    const provider = await resolveProvider(this.userId, this.opts);
    yield* provider.stream(req);
  }
}
