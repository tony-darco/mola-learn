import { ToolRegistry } from "../registry";
import { courseFactsTool } from "./course-facts";
import { grepSearchTool } from "./grep-search";
import { bm25SearchTool } from "./bm25-search";
import { vectorSearchTool } from "./vector-search";
import { calculatorTool } from "./calculator";

/**
 * The single place tools are wired up. Phase 1 agents add their tools HERE
 * rather than constructing their own registry, so Layer 3's catalog and the
 * provider's tool specs stay in sync automatically.
 */
export function buildRegistry(): ToolRegistry {
  return new ToolRegistry()
    .register(courseFactsTool)
    .register(grepSearchTool)
    .register(bm25SearchTool)
    .register(vectorSearchTool)
    .register(calculatorTool);
}

/** The retrieval agent's tool allowlist (§6) — used by runRetrievalAgent's subagent spec. */
export const RETRIEVAL_TOOL_NAMES = ["grep_search", "bm25_search", "vector_search"] as const;
