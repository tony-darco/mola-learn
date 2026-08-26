/**
 * CONTRACT 4 (part 3) — the sub-agent spawner. FROZEN, working from Phase 0.
 *
 * A sub-agent is a fresh conversation from a blank context, spawned by a single
 * briefing prompt (§4). It inherits none of the parent's history, runs its own
 * tool loop privately, and returns only a final result. Intermediate retrieval
 * and drafting noise never touches the parent conversation.
 *
 * Expensive (~7x tokens) but context-safe. Agent C's ReAct retrieval agent runs
 * on this; the flashcard skill spins a fresh one per create AND per amendment.
 */
import type { StreamEvent } from "@mola/shared";
import { getChatProvider } from "../llm";
import type { Message } from "../llm/types";
import { runAgentLoop } from "./loop";
import type { ToolContext, ToolRegistry } from "./registry";

export type SubagentSpec = {
  /** Shown to the user as one collapsed row; internals stay private. */
  label: string;
  systemPrompt: string;
  briefing: string;
  /** Restricted tool list — a sub-agent sees only what it needs (§4). */
  toolAllowlist: readonly string[];
  maxIterations?: number;
};

export type SubagentResult = {
  /** Final text, or the artifact envelope if the sub-agent produced one. */
  result: unknown;
  iterations: number;
};

export async function runSubagent(
  spec: SubagentSpec,
  registry: ToolRegistry,
  ctx: ToolContext,
): Promise<SubagentResult> {
  const tools = registry.subset(spec.toolAllowlist);
  const messages: Message[] = [{ role: "user", content: spec.briefing }];

  let text = "";
  let artifact: unknown = null;
  let iterations = 0;

  for await (const ev of runAgentLoop({
    provider: getChatProvider(ctx.session.userId),
    system: spec.systemPrompt,
    messages,
    tools,
    ctx,
    maxIterations: spec.maxIterations ?? 6,
    // A sub-agent hands its artifact up to the parent rather than persisting
    // it itself, so ownership stamping stays in exactly one place.
    persistArtifact: async (result) => {
      artifact = result;
      return null;
    },
  })) {
    if (ev.type === "text_delta") text += ev.text;
    if (ev.type === "tool_call_end") iterations++;
  }

  return { result: artifact ?? text, iterations };
}

/** Wraps a sub-agent run in the two events the client renders as one row. */
export async function* streamSubagent(
  spec: SubagentSpec,
  registry: ToolRegistry,
  ctx: ToolContext,
): AsyncGenerator<StreamEvent, SubagentResult> {
  const subagentId = `sub_${Math.random().toString(36).slice(2, 10)}`;
  yield { type: "subagent_start", subagentId, label: spec.label };
  const result = await runSubagent(spec, registry, ctx);
  yield { type: "subagent_end", subagentId };
  return result;
}
