/**
 * Predefined Ollama chat models (§ model switcher). Hardcoded for this pass —
 * no live discovery against the Ollama host yet.
 *
 * `supportsThinking` matters beyond display: Ollama's /api/chat hard-errors
 * ("does not support thinking") if `think: true` is sent for a model whose
 * capabilities don't include it — confirmed live against rnj-1:latest, which
 * has no "thinking" entry in /api/tags unlike the other four. Enforced in
 * `resolveProvider` (lib/llm/index.ts), not just the picker UI, so a stale
 * chat row (model switched away from a thinking model, thinkingEnabled still
 * on) can never produce that error.
 */
export type ChatModelOption = {
  /** Exact Ollama tag, sent as-is to /api/chat. */
  id: string;
  label: string;
  description: string;
  supportsThinking: boolean;
};

// Gemma 4 only. Retiring a model here needs a data migration too (see
// 0012_retire_non_gemma_models.sql) — a chat or user row still naming it is
// rejected as "unknown model" by the chat API and the picker.
export const CHAT_MODELS: readonly ChatModelOption[] = [
  { id: "gemma4:26b", label: "gemma4:26b", description: "Default — 26B, fast", supportsThinking: true },
  { id: "gemma4:12b", label: "gemma4:12b", description: "12B general", supportsThinking: true },
] as const;

export function modelSupportsThinking(modelId: string): boolean {
  // Unrecognized id (a retired model still on an old chat row, or an
  // unlisted MOLA_CHAT_MODEL) must default to NOT supporting thinking —
  // sending think:true to a model that can't handle it is a hard Ollama
  // 400, while think:false to one that can is always a harmless no-op.
  return CHAT_MODELS.find((m) => m.id === modelId)?.supportsThinking ?? false;
}
