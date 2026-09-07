import { ToolRegistry } from "../registry";
import { withCallLogging } from "@/lib/debug/tool-log";
import { courseFactsTool } from "./course-facts";
import { grepSearchTool } from "./grep-search";
import { bm25SearchTool } from "./bm25-search";
import { vectorSearchTool } from "./vector-search";
import { grepChatSearchTool } from "./grep-chat-search";
import { bm25ChatSearchTool } from "./bm25-chat-search";
import { calculatorTool } from "./calculator";
import { createFlashcardDeckTool } from "./flashcards";
import { getDueFlashcardsTool, recordFlashcardReviewTool } from "./flashcard-review";
import { createQuizTool } from "./quizzes";
import { createMindMapTool } from "./mindmaps";

/**
 * The single place tools are wired up. Phase 1 agents add their tools HERE
 * rather than constructing their own registry, so Layer 3's catalog and the
 * provider's tool specs stay in sync automatically.
 *
 * Every tool is wrapped with withCallLogging (lib/debug/tool-log.ts) — a
 * no-op unless the debug logger's own gate is satisfied. flashcards.ts,
 * quizzes.ts, and mindmaps.ts each also spin a private sub-agent registry of
 * their own that never passes through here — those wrap the same way at
 * their own `.register()` call sites.
 */
export function buildRegistry(): ToolRegistry {
  return new ToolRegistry()
    .register(withCallLogging(courseFactsTool))
    .register(withCallLogging(grepSearchTool))
    .register(withCallLogging(bm25SearchTool))
    .register(withCallLogging(vectorSearchTool))
    .register(withCallLogging(grepChatSearchTool))
    .register(withCallLogging(bm25ChatSearchTool))
    .register(withCallLogging(calculatorTool))
    .register(withCallLogging(createFlashcardDeckTool))
    .register(withCallLogging(getDueFlashcardsTool))
    .register(withCallLogging(recordFlashcardReviewTool))
    .register(withCallLogging(createQuizTool))
    .register(withCallLogging(createMindMapTool));
}

/** The retrieval agent's tool allowlist (§6) — used by runRetrievalAgent's subagent spec. */
export const RETRIEVAL_TOOL_NAMES = ["grep_search", "bm25_search", "vector_search"] as const;
