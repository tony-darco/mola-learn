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

export const CHAT_MODELS: readonly ChatModelOption[] = [
  { id: "qwen3.6:27b", label: "qwen3.6:27b", description: "Current default", supportsThinking: true },
  { id: "rnj-1:latest", label: "RNJ-1", description: "8B, code and STEM", supportsThinking: false },
  { id: "gemma4:26b", label: "gemma4:26b", description: "26B general", supportsThinking: true },
  { id: "gemma4:12b", label: "gemma4:12b", description: "12B general", supportsThinking: true },
  { id: "qwen3.8:27b", label: "qwen3.8:27b", description: "27B latest", supportsThinking: true },
] as const;

export function modelSupportsThinking(modelId: string): boolean {
  // Unrecognized id (a retired model still on an old chat row, or an
  // unlisted MOLA_CHAT_MODEL) must default to NOT supporting thinking —
  // sending think:true to a model that can't handle it is a hard Ollama
  // 400, while think:false to one that can is always a harmless no-op.
  return CHAT_MODELS.find((m) => m.id === modelId)?.supportsThinking ?? false;
}
