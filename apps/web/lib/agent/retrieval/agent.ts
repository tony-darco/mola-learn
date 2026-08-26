/**
 * The retrieval agent (§6) — ReAct: reason → act → observe.
 *
 * Spun up FRESH per question via `runSubagent` (contract 4), not called as a
 * flat tool — §6 is explicit about this. It gets a blank context, a briefing
 * with just the student's question, and a restricted three-tool allowlist.
 * Intermediate search noise (which tool, which query, which chunk came back
 * thin) never reaches the parent conversation — only the final grounded
 * answer does.
 */
import { RETRIEVAL_TOOL_NAMES } from "../tools";
import { runSubagent } from "../subagent";
import type { ToolContext, ToolRegistry } from "../registry";

const SYSTEM_PROMPT = `You are a document retrieval agent for a university student's course materials.

You have three search tools:
- grep_search: exact literal substring/phrase match (names, codes, exact dates). No ranking.
- bm25_search: keyword relevance ranking. Strong on exact terms, weak on paraphrase.
- vector_search: semantic/meaning search. Strong on paraphrase, but only works on
  documents that are fully indexed — it tells you plainly when nothing in scope is
  indexed yet, instead of pretending to have searched.

Rules:
- Reason about which tool fits the question, call it, read the observation, and decide
  whether to search again before answering. Try more than one tool when the first
  result is thin or you are unsure — grep/BM25 and vector search fail in opposite ways,
  so a weak result from one is a reason to try another, not a reason to stop.
- If vector_search reports it is not indexed, fall back to grep_search and bm25_search.
  Never guess at an answer a tool did not actually return.
- Ground every claim in a retrieved chunk. If you cannot find something, say so plainly.
- If any relevant document could not be fully searched (not yet indexed), tell the
  student that explicitly in your final answer — do not silently omit it.
- Keep the final answer concise and cite the source document by title.`;

export function buildRetrievalBriefing(question: string): string {
  return `Student question: ${question}\n\nSearch the available course documents and answer using only what the tools return.`;
}

export type RetrievalAgentResult = {
  answer: string;
  iterations: number;
};

/**
 * Runs the ReAct retrieval agent for one question. Always spawns a fresh
 * sub-agent (never a flat tool call) so retrieval reasoning never pollutes
 * the parent chat's context.
 */
export async function runRetrievalAgent(
  question: string,
  registry: ToolRegistry,
  ctx: ToolContext,
): Promise<RetrievalAgentResult> {
  const { result, iterations } = await runSubagent(
    {
      label: "Searching course documents",
      systemPrompt: SYSTEM_PROMPT,
      briefing: buildRetrievalBriefing(question),
      toolAllowlist: RETRIEVAL_TOOL_NAMES,
      maxIterations: 6,
    },
    registry,
    ctx,
  );

  return { answer: typeof result === "string" ? result : JSON.stringify(result), iterations };
}
