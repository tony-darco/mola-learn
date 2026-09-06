/**
 * Agent G — quizzes (§6, Phase 1.5). Mirrors flashcards.ts's shape exactly:
 * `create_quiz` is the only tool of this module registered on the main
 * registry (tools/index.ts). It spins a fresh sub-agent scoped to its own
 * one-off ToolRegistry containing the three retrieval tools plus
 * `emit_quiz` — a tool that exists ONLY in that scoped registry, never the
 * shared one, so it can never reach the top-level model's own tool list.
 *
 * Deliberately think:false (the user's own explicit call, made when setting
 * this goal): question-writing doesn't need reasoning, and a non-thinking
 * pass is the whole point — faster turnaround for something the student is
 * waiting on. Overridden by passing a shallow-cloned ToolContext into
 * runSubagent rather than touching loop.ts/subagent.ts (both frozen,
 * contract 4) — SubagentSpec has no think override of its own, so the
 * caller-supplied ctx is the only lever, and it's plain data, not a
 * contract shape.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { type ArtifactToolResult, quizPayloadSchema } from "@mola/shared";
import { db, users } from "@mola/db";
import { eq } from "drizzle-orm";
import type { Tool, ToolContext } from "../registry";
import { ToolRegistry } from "../registry";
import { runSubagent } from "../subagent";
import { grepSearchTool } from "./grep-search";
import { bm25SearchTool } from "./bm25-search";
import { vectorSearchTool } from "./vector-search";

// See flashcards.ts's identical toolSourceRefSchema for why this exists —
// the frozen sourceRefSchema's chunkOrdinals default gives it an _input type
// that Tool<I>'s inputSchema: z.ZodType<I> can't structurally accept.
const toolSourceRefSchema = z.object({
  documentId: z.string().uuid(),
  documentTitle: z.string(),
  locator: z.string().nullable(),
  chunkOrdinals: z.array(z.number().int().nonnegative()).optional(),
});

const emitQuestionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("multiple_choice"),
    prompt: z.string().min(1),
    options: z.array(z.string()).min(2).max(6),
    correctIndex: z.number().int().nonnegative(),
    explanation: z.string().nullable().optional(),
  }),
  z.object({
    type: z.literal("short_answer"),
    prompt: z.string().min(1),
    expectedAnswer: z.string().min(1),
    explanation: z.string().nullable().optional(),
  }),
]);

const emitInputSchema = z.object({
  title: z.string().min(1).describe("Quiz title, e.g. \"Chapter 1: Linear Equations Quiz\""),
  difficulty: z.enum(["intro", "standard", "hard"]),
  topics: z.array(z.string()).optional().describe("Short topic tags for search on the Artifacts page"),
  sources: z.array(toolSourceRefSchema).optional().describe("Documents/sections the questions were actually drawn from"),
  questions: z.array(emitQuestionSchema).min(1).describe("The quiz questions, each grounded in a retrieved chunk"),
});

/**
 * Sub-agent-only — deliberately never passed to buildRegistry(). Terminal
 * call of the quiz-writing sub-agent: validates the quiz shape and wraps it
 * as the artifact envelope the parent loop knows how to persist. Question
 * ids are minted here, never trusted from the model, same discipline as
 * emit_flashcard_deck's card ids.
 */
const emitQuizTool: Tool<z.infer<typeof emitInputSchema>> = {
  name: "emit_quiz",
  description: "Finalize the quiz. Call this exactly once, after research, with the complete question set.",
  inputSchema: emitInputSchema,
  label: () => "Writing quiz",

  async execute(input): Promise<ArtifactToolResult> {
    const payload = quizPayloadSchema.parse({
      kind: "quiz",
      difficulty: input.difficulty,
      questions: input.questions.map((q) =>
        q.type === "multiple_choice"
          ? {
              type: "multiple_choice" as const,
              id: randomUUID(),
              prompt: q.prompt,
              options: q.options,
              correctIndex: q.correctIndex,
              explanation: q.explanation ?? null,
            }
          : {
              type: "short_answer" as const,
              id: randomUUID(),
              prompt: q.prompt,
              expectedAnswer: q.expectedAnswer,
              explanation: q.explanation ?? null,
            },
      ),
    });
    return {
      __artifact: true,
      kind: "quiz",
      title: input.title,
      topics: input.topics ?? [],
      sources: (input.sources ?? []).map((s) => ({ ...s, chunkOrdinals: s.chunkOrdinals ?? [] })),
      payload,
      replacesArtifactId: null,
    };
  },
};

const createInputSchema = z.object({
  topic: z.string().min(1).describe("What the quiz should cover, e.g. \"row reduction and echelon forms\""),
  count: z.number().int().min(1).max(30).optional().describe("How many questions to generate (defaults to the student's Settings preference, normally 10)"),
  difficulty: z.enum(["intro", "standard", "hard"]).optional().describe("Defaults to standard"),
});

const SYSTEM_PROMPT = `You are a quiz-writing agent for a university student's course materials.

You have three search tools (grep_search, bm25_search, vector_search) and one
finishing tool (emit_quiz).

Rules:
- Research the requested topic using the search tools before writing any question.
  Try more than one tool if the first result is thin.
- Every question, and its correct answer, must be grounded in something a tool
  actually returned. Never invent a fact, definition, or formula that didn't come
  from a retrieved chunk.
- Before finalizing each question, re-check your chosen correct answer against the
  source text you retrieved. A wrong answer key is worse than a bad question — do
  not guess.
- Prefer multiple_choice (2-6 options; true/false is just a 2-option case of this).
  Use short_answer only when the concept genuinely resists being turned into
  distinct options without an unfair guess.
- Wrong options should be plausible, not absurd — a distractor drawn from a
  neighboring concept in the same source tests understanding better than a
  random wrong answer.
- Populate "sources" with the documents/sections you actually drew from — each search
  result includes a "documentId" (a UUID); use that exact value, never a filename or
  a made-up id. If you truly cannot find one, omit sources rather than guessing.
- Call emit_quiz exactly once, with the complete quiz, as your final action.
- Never use emoji, in any output, for any reason.`;

export const createQuizTool: Tool<z.infer<typeof createInputSchema>> = {
  name: "create_quiz",
  description:
    "Generate a quiz grounded in the student's course documents. Use when the student asks " +
    "to make, create, or take a quiz or test on a topic.",
  inputSchema: createInputSchema,
  label: (input) => `Creating quiz: ${input.topic}`,

  async execute(input, ctx) {
    const subRegistry = new ToolRegistry()
      .register(grepSearchTool)
      .register(bm25SearchTool)
      .register(vectorSearchTool)
      .register(emitQuizTool);

    let count = input.count;
    if (!count) {
      const [user] = await db.select({ n: users.defaultQuizQuestionCount })
        .from(users).where(eq(users.id, ctx.session.userId)).limit(1);
      count = user?.n ?? 10;
    }
    const difficulty = input.difficulty ?? "standard";

    // think:false — see module docstring. A plain object, not a mutation of
    // the caller's ctx.
    const quizCtx: ToolContext = { ...ctx, think: false };

    const { result } = await runSubagent(
      {
        label: `Writing a ${count}-question quiz on "${input.topic}"`,
        systemPrompt: SYSTEM_PROMPT,
        briefing: `Create a ${count}-question, ${difficulty}-difficulty quiz on: ${input.topic}`,
        toolAllowlist: ["grep_search", "bm25_search", "vector_search", "emit_quiz"],
        maxIterations: 12,
      },
      subRegistry,
      quizCtx,
    );

    return result;
  },
};
