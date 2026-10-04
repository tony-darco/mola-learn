/**
 * One model call for the evals, through the app's own OllamaProvider.
 *
 * Importing this loads apps/web/.env.local first, like e2e/global-setup.ts:
 * a plain Node process doesn't get it for free, and lib/llm/ollama.ts reads
 * OLLAMA_HOST when it is imported — so nothing that imports lib/llm/ollama.ts
 * may be imported before this module.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
// Type-only: erased, so it loads nothing before .env.local.
import type { ToolSpec } from "@/lib/llm/types";

const envPath = resolve(fileURLToPath(new URL(".", import.meta.url)), "../.env.local");
if (existsSync(envPath)) process.loadEnvFile(envPath);
/** The app's provider, for an eval that runs more than one call (the canvas chat's reply loop). */
export const { OllamaProvider } = await import("@/lib/llm/ollama");

/**
 * `firstTokenMs`: when the first visible token or tool call arrived — for a thinking model, roughly how long it thought.
 * `toolCalls`: the calls the model made, when it was offered `tools`.
 */
export type CallResult = {
  raw: string; toolCalls: { name: string; input: unknown }[]; stopReason: string | null; errors: string[];
  latencyMs: number; firstTokenMs: number | null; attempts: number; timedOut: boolean;
};

const describeError = (err: unknown) => {
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause as { code?: string; message?: string } | undefined;
  return cause ? `${err.message} (${cause.code ?? cause.message})` : err.message;
};

/**
 * One call, never throwing. A network failure before any output (a
 * transient EHOSTUNREACH) is retried twice; a call cut off at `timeoutMs`
 * is not.
 */
export async function ask(
  model: string, think: boolean, system: string, prompt: string, opts: { maxTokens?: number; timeoutMs?: number; tools?: ToolSpec[] } = {},
): Promise<CallResult> {
  const provider = new OllamaProvider(model, think);
  const errors: string[] = [];
  for (let attempt = 1; ; attempt++) {
    const signal = opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined;
    const started = performance.now();
    let raw = "";
    const toolCalls: CallResult["toolCalls"] = [];
    let stopReason: string | null = null;
    let firstTokenMs: number | null = null;
    try {
      for await (const ev of provider.stream({ system, messages: [{ role: "user", content: prompt }], maxTokens: opts.maxTokens, tools: opts.tools, signal })) {
        if (ev.type === "text_delta") {
          firstTokenMs ??= Math.round(performance.now() - started);
          raw += ev.text;
        } else if (ev.type === "tool_call") {
          firstTokenMs ??= Math.round(performance.now() - started);
          toolCalls.push({ name: ev.name, input: ev.input });
        } else if (ev.type === "done") stopReason = ev.stopReason;
        else if (ev.type === "error") errors.push(ev.message);
      }
    } catch (err) {
      errors.push(`attempt ${attempt}: ${describeError(err)}`);
      if (!raw && !toolCalls.length && attempt < 3 && !signal?.aborted) {
        await new Promise((r) => setTimeout(r, 5_000));
        continue;
      }
    }
    const timedOut = !!signal?.aborted;
    if (timedOut) errors.push(`cut off after ${opts.timeoutMs! / 60_000} minutes`);
    return { raw, toolCalls, stopReason, errors, latencyMs: Math.round(performance.now() - started), firstTokenMs, attempts: attempt, timedOut };
  }
}
