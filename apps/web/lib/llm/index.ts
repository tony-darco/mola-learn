import { eq } from "drizzle-orm";
import { apiKeys, db } from "@mola/db";
import { decryptSecret } from "@/lib/auth/crypto";
import { OllamaProvider } from "./ollama";
import { AnthropicProvider } from "./providers/anthropic";
import { OpenAIProvider } from "./providers/openai";
import type { CompletionRequest, LLMProvider } from "./types";
import type { ProviderStreamEvent } from "@mola/shared";

export * from "./types";
export { OllamaProvider, DEFAULT_CHAT_MODEL } from "./ollama";
export { SelfHostedEmbeddingProvider } from "./embedding";

async function resolveProvider(userId: string): Promise<LLMProvider> {
  const [key] = await db.select().from(apiKeys).where(eq(apiKeys.userId, userId)).limit(1);
  if (!key) return new OllamaProvider();

  const plaintext = decryptSecret({ ciphertext: key.ciphertext, iv: key.iv, authTag: key.authTag });
  switch (key.provider) {
    case "openai":
      return new OpenAIProvider(plaintext);
    case "anthropic":
      return new AnthropicProvider(plaintext);
    default:
      return new OllamaProvider();
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
export function getChatProvider(userId: string): LLMProvider {
  return new LazyProvider(userId);
}

class LazyProvider implements LLMProvider {
  readonly id = "byok-or-ollama";
  constructor(private readonly userId: string) {}

  async *stream(req: CompletionRequest): AsyncIterable<ProviderStreamEvent> {
    const provider = await resolveProvider(this.userId);
    yield* provider.stream(req);
  }
}
