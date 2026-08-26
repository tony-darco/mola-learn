import { OllamaProvider } from "./ollama";
import type { LLMProvider } from "./types";

export * from "./types";
export { OllamaProvider, DEFAULT_CHAT_MODEL } from "./ollama";
export { SelfHostedEmbeddingProvider } from "./embedding";

/**
 * Resolves the chat provider for a user. Phase 0 always returns Ollama;
 * Agent D extends this to read the user's BYOK provider + decrypted key.
 * Callers never construct a provider directly.
 */
export function getChatProvider(_userId: string): LLMProvider {
  return new OllamaProvider();
}
