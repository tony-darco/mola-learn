/**
 * Agent E — flashcards (§6, Phase 1.5).
 *
 * "Skill wrapping a sub-agent — every create and every amendment spins a
 * fresh sub-agent." `create_flashcard_deck` is the skill: the ONLY tool of
 * this module registered on the main registry (tools/index.ts). Calling it
 * spins a fresh sub-agent, scoped to its own one-off ToolRegistry containing
 * the three retrieval tools plus `emit_flashcard_deck` — a tool that exists
 * ONLY in that scoped registry, never in the shared one, so it can never
 * reach the top-level model's own tool list.
 *
 * The sub-agent researches the topic, then calls emit_flashcard_deck exactly
 * once; that call's result is an ArtifactToolResult (contract 6), which
 * bubbles up through runSubagent -> this tool's return value -> the PARENT
 * loop's own isArtifactToolResult check (loop.ts, frozen) -> the real
 * persistArtifact in route.ts. No change needed to any frozen file.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { type ArtifactToolResult, flashcardDeckPayloadSchema } from "@mola/shared";
import type { Tool } from "../registry";
import { ToolRegistry } from "../registry";
import { runSubagent } from "../subagent";
import { withCallLogging } from "@/lib/debug/tool-log";
import { grepSearchTool } from "./grep-search";
import { bm25SearchTool } from "./bm25-search";
import { vectorSearchTool } from "./vector-search";

// A local variant of the frozen sourceRefSchema (packages/shared) without its
// `chunkOrdinals` default — that default gives sourceRefSchema an _input type
// that differs from its _output type, which Tool<I>'s `inputSchema: z.ZodType<I>`
// (I = the OUTPUT type) can't structurally accept. Normalized back into the
// real sourceRefSchema shape in execute() below.
const toolSourceRefSchema = z.object({
  documentId: z.string().uuid(),
  documentTitle: z.string(),
  locator: z.string().nullable(),
  chunkOrdinals: z.array(z.number().int().nonnegative()).optional(),
});

const emitInputSchema = z.object({
  title: z.string().min(1).describe("Deck title, e.g. \"Chapter 1: Linear Equations\""),
  topics: z.array(z.string()).optional().describe("Short topic tags for search on the Artifacts page"),
  sources: z.array(toolSourceRefSchema).optional().describe("Documents/sections the cards were actually drawn from"),
  cards: z.array(z.object({
    front: z.string().min(1),
    back: z.string().min(1),
    chapter: z.string().nullable().optional(),
    section: z.string().nullable().optional(),
    week: z.number().int().positive().nullable().optional(),
  })).min(1).describe("The flashcards themselves — front (prompt) and back (answer)"),
});

/**
 * Sub-agent-only — deliberately never passed to buildRegistry(). Terminal
 * call of the flashcard-creation sub-agent: validates the deck shape and
 * wraps it as the artifact envelope the parent loop knows how to persist.
 */
const emitFlashcardDeckTool: Tool<z.infer<typeof emitInputSchema>> = {
  name: "emit_flashcard_deck",
  description: "Finalize the flashcard deck. Call this exactly once, after research, with the complete card set.",
  inputSchema: emitInputSchema,
  label: () => "Writing flashcard deck",

  async execute(input): Promise<ArtifactToolResult> {
    const payload = flashcardDeckPayloadSchema.parse({
      kind: "flashcard_deck",
      cards: input.cards.map((c) => ({
        id: randomUUID(),
        front: c.front,
        back: c.back,
        chapter: c.chapter ?? null,
        section: c.section ?? null,
        week: c.week ?? null,
      })),
    });
    return {
      __artifact: true,
      kind: "flashcard_deck",
      title: input.title,
      topics: input.topics ?? [],
      sources: (input.sources ?? []).map((s) => ({ ...s, chunkOrdinals: s.chunkOrdinals ?? [] })),
      payload,
      replacesArtifactId: null,
    };
  },
};

const createInputSchema = z.object({
  topic: z.string().min(1).describe("What the deck should cover, e.g. \"row reduction and echelon forms\""),
  count: z.number().int().min(1).max(30).optional().describe("How many cards to generate (default 10)"),
});

const SYSTEM_PROMPT = `You are a flashcard-writing agent for a university student's course materials.

You have three search tools (grep_search, bm25_search, vector_search) and one
finishing tool (emit_flashcard_deck).

Rules:
- Research the requested topic using the search tools before writing any card.
  Try more than one tool if the first result is thin.
- Every card must be grounded in something a tool actually returned. Never invent
  a fact, definition, or formula that didn't come from a retrieved chunk.
- Write cards that test recall, not recognition: the front is a question or prompt,
  never a fill-in-the-blank restatement of the back.
- Tag chapter/section from the source locator when it's derivable (e.g. a "p.85"
  locator inside a "1.7 Linear Independence" section becomes chapter "1", section "1.7").
- Populate "sources" with the documents/sections you actually drew from — each search
  result includes a "documentId" (a UUID); use that exact value, never a filename or
  a made-up id. If you truly cannot find one, omit sources rather than guessing.
- Call emit_flashcard_deck exactly once, with the complete deck, as your final action.
- Never use emoji, in any output, for any reason.`;

export const createFlashcardDeckTool: Tool<z.infer<typeof createInputSchema>> = {
  name: "create_flashcard_deck",
  description:
    "Generate a flashcard deck grounded in the student's course documents. Use when the student asks " +
    "to make, create, or study flashcards on a topic.",
  inputSchema: createInputSchema,
  label: (input) => `Creating flashcards: ${input.topic}`,

  async execute(input, ctx) {
    // This private sub-agent registry never passes through buildRegistry()
    // (tools/index.ts) — wrapped again here so its tool calls (research +
    // the final emit_flashcard_deck) still reach the debug logger.
    const subRegistry = new ToolRegistry()
      .register(withCallLogging(grepSearchTool))
      .register(withCallLogging(bm25SearchTool))
      .register(withCallLogging(vectorSearchTool))
      .register(withCallLogging(emitFlashcardDeckTool));

    const count = input.count ?? 10;
    const { result } = await runSubagent(
      {
        label: `Writing ${count} flashcards on "${input.topic}"`,
        systemPrompt: SYSTEM_PROMPT,
        briefing: `Create a ${count}-card flashcard deck on: ${input.topic}`,
        toolAllowlist: ["grep_search", "bm25_search", "vector_search", "emit_flashcard_deck"],
        maxIterations: 10,
      },
      subRegistry,
      ctx,
    );

    return result;
  },
};
