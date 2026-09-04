/**
 * Compaction (§4, Layer 5 — CONTRACTS.md contract 5's "history" layer).
 *
 * Recent turns stay raw and verbatim; older turns collapse at a compact
 * boundary into a written summary of state, decisions, and key facts. The
 * full raw transcript ALWAYS remains retrievable underneath — this module
 * only ever INSERTs a compaction_boundaries row. It never updates or deletes
 * a messages row, which is the correctness property the raw-turn-preservation
 * test in tests/compaction.test.ts checks directly.
 *
 * `buildLayer5` in lib/context/assemble.ts (frozen, off-limits to Agent A)
 * already reads the boundary this writes — this file is the missing half:
 * deciding when to fold, and writing the summary.
 */
import { asc, desc, eq } from "drizzle-orm";
import { compactionBoundaries, db, messages } from "@mola/db";
import { getChatProvider, type ChatProviderOptions } from "../llm";
import type { Message } from "../llm/types";

/** Compact once more than this many raw turns have piled up since the last boundary. */
export const COMPACT_THRESHOLD = 16;
/** Turns that stay raw and verbatim after compaction runs. */
export const KEEP_RAW = 8;

export type Summarizer = (
  turns: { role: string; content: string }[],
  priorSummary: string | null,
) => Promise<string>;

/**
 * Builds a summarizer bound to a specific chat's model/thinking choice —
 * pass the result as maybeCompact's `summarize` override so a chat's
 * compaction runs on the same model the user picked for it, instead of the
 * platform default.
 */
export function makeLlmSummarizer(userId: string, opts?: ChatProviderOptions): Summarizer {
  return async (turns, priorSummary) => {
    const provider = getChatProvider(userId, opts);
    const transcript = turns.map((t) => `${t.role}: ${t.content}`).join("\n");
    const req: Message[] = [
      {
        role: "user",
        content:
          (priorSummary ? `Earlier summary so far:\n${priorSummary}\n\n` : "") +
          "Fold the conversation segment below into an updated summary for continuity: " +
          "the student's goals, decisions made, and key facts established. Concise plain " +
          "prose, no preamble, no meta-commentary.\n\n" + transcript,
      },
    ];

    let text = "";
    for await (const ev of provider.stream({ system: "You write terse conversation summaries.", messages: req })) {
      if (ev.type === "text_delta") text += ev.text;
      if (ev.type === "error") throw new Error(ev.message);
    }
    return text.trim();
  };
}

/** Default summarizer: one plain LLM call over the folded turns, no tools, platform default model. */
export const llmSummarizer: Summarizer = makeLlmSummarizer("system");

export type CompactResult = { throughMessageId: string; summary: string };

/**
 * Folds everything but the last KEEP_RAW turns into a new compaction boundary,
 * if enough raw turns have piled up since the last one to be worth it.
 * Returns null when there's nothing to do. Never mutates or removes a message.
 */
export async function maybeCompact(
  chatId: string,
  userId: string,
  summarize: Summarizer = llmSummarizer,
): Promise<CompactResult | null> {
  const all = await db.select().from(messages)
    .where(eq(messages.chatId, chatId))
    .orderBy(asc(messages.createdAt));

  const [priorBoundary] = await db
    .select().from(compactionBoundaries)
    .where(eq(compactionBoundaries.chatId, chatId))
    .orderBy(desc(compactionBoundaries.createdAt))
    .limit(1);

  const boundaryIdx = priorBoundary
    ? all.findIndex((m) => m.id === priorBoundary.upToMessageId)
    : -1;
  const uncompacted = all.slice(boundaryIdx + 1).filter((m) => m.role === "user" || m.role === "assistant");

  if (uncompacted.length <= COMPACT_THRESHOLD) return null;

  const foldCount = uncompacted.length - KEEP_RAW;
  const toFold = uncompacted.slice(0, foldCount);
  const boundaryMessage = toFold.at(-1);
  if (!boundaryMessage) return null;

  const summary = await summarize(
    toFold.map((m) => ({ role: m.role, content: m.content })),
    priorBoundary?.summary ?? null,
  );

  await db.insert(compactionBoundaries).values({
    userId, chatId, upToMessageId: boundaryMessage.id, summary,
  });

  return { throughMessageId: boundaryMessage.id, summary };
}
