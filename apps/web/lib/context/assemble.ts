/**
 * CONTRACT 5 — the context layer system. FROZEN.
 *
 * Five ordered layers (§5). Layers 1–4 are deterministic and ALWAYS loaded;
 * only layer 5 and retrieval results are judged for relevance.
 *
 * Freezing this signature early is what lets the retrieval, Socratic and
 * planning workstreams all plug into the same spine. Phase 1 agents fill in
 * the layers marked STUB — the shape does not change.
 */
import { and, asc, desc, eq } from "drizzle-orm";
import type { HintRung } from "@mola/shared";
import {
  chats, compactionBoundaries, courses, db, documents, messages, users,
} from "@mola/db";
import type { Message } from "../llm/types";
import type { ToolRegistry } from "../agent/registry";
import { buildLayer4 } from "./hint-ladder";

export type AssembleInput = {
  userId: string;
  chatId: string;
  courseId: string | null;
  tools: ToolRegistry;
  hintRung: HintRung | null;
  /** Raw turns kept verbatim before the compact boundary (§4). */
  rawTurnLimit?: number;
};

export type AssembledContext = {
  /** Layers 1–4, concatenated in order. */
  system: string;
  /** Layer 5 — raw recent turns plus compacted summaries. */
  messages: Message[];
  /** Per-layer text, exposed so the thin slice can assert all five are present. */
  layers: Record<"identity" | "calendar" | "catalog" | "rules" | "history", string>;
};

export async function assembleContext(input: AssembleInput): Promise<AssembledContext> {
  const identity = await buildLayer1(input.userId, input.courseId);
  const calendar = await buildLayer2(input.userId);
  const catalog = await buildLayer3(input.userId, input.courseId, input.tools);
  const rules = await buildLayer4Text(input.courseId, input.hintRung);
  const { text: history, messages: turns } = await buildLayer5(
    input.userId, input.chatId, input.rawTurnLimit ?? 20,
  );

  return {
    system: [identity, calendar, catalog, rules].join("\n\n---\n\n"),
    messages: turns,
    layers: { identity, calendar, catalog, rules, history },
  };
}

/**
 * LAYER 1 — identity / static context. Always stamped in, never filtered:
 * cheap and small, mirroring Claude Code's always-present environment info.
 *
 * The course summary is read from the courses row — the SAME row the detail
 * page displays and the student edits. One row, read by everything (§8).
 */
async function buildLayer1(userId: string, courseId: string | null): Promise<string> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error(`unknown user ${userId}`);

  const enrolled = await db.select().from(courses).where(eq(courses.userId, userId));
  const active = courseId ? enrolled.find((c) => c.id === courseId) : undefined;

  const lines = [
    "# Student",
    `Name: ${user.name}`,
    user.university ? `University: ${user.university}` : null,
    user.year ? `Year: ${user.year}` : null,
    "",
    "# Enrolled courses",
    ...enrolled.map((c) => `- ${c.number ?? "—"} ${c.name}${c.professor ? ` (${c.professor})` : ""}`),
  ].filter(Boolean);

  if (active) {
    lines.push(
      "",
      `# Current course: ${active.number ?? ""} ${active.name}`.trim(),
      active.summary ?? "(no syllabus summary yet)",
    );
  }
  return lines.join("\n");
}

/**
 * LAYER 2 — calendar, three horizons: today / this week / semester (§5).
 * STUB: Agent J fills these from schedule_items and the planning loop.
 */
async function buildLayer2(_userId: string): Promise<string> {
  return [
    "# Schedule",
    "## Today",
    "(no plan yet)",
    "## This week",
    "(no plan yet)",
    "## Semester",
    "(no plan yet)",
  ].join("\n");
}

/**
 * LAYER 3 — available skills, tools and documents.
 *
 * Names plus ONE-LINE descriptions only, mirroring Claude Code's
 * <available_skills> injection. Full skill instructions and full document
 * content are pulled in only on demand (§5).
 */
async function buildLayer3(
  userId: string, courseId: string | null, tools: ToolRegistry,
): Promise<string> {
  const where = courseId
    ? and(eq(documents.userId, userId), eq(documents.courseId, courseId))
    : eq(documents.userId, userId);
  const docs = await db.select().from(documents).where(where).orderBy(asc(documents.title));

  return [
    "# Available tools",
    ...tools.catalog().map((t) => `- ${t.name}: ${t.description}`),
    "",
    "# Available documents",
    // Status is surfaced so the retrieval agent gets a clear "not indexed"
    // signal and falls back to grep/BM25 rather than guessing (§6).
    ...(docs.length
      ? docs.map((d) => {
          const oneLiner = pointerOneLiner(d.pointerMd);
          const base = `- [${d.kind}] ${d.title} — status: ${d.status}`;
          return oneLiner ? `${base} — ${oneLiner}` : base;
        })
      : ["(none uploaded yet)"]),
  ].join("\n");
}

/**
 * A document's pointer file (§7, populated by Agent B) is a SKILL.md-styled
 * markdown with title, topic summary, foreword-style summary and embedding
 * status — never injected here in full (§7: "the pointer is what gets
 * injected into layer 3; never the full content"). Layer 3 gets names plus
 * one-line descriptions only, so this pulls just the first line of actual
 * content out of it. Null until Agent B's pipeline populates it.
 */
function pointerOneLiner(pointerMd: string | null): string | null {
  if (!pointerMd) return null;
  const line = pointerMd
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith("#"));
  if (!line) return null;
  return line.length > 140 ? `${line.slice(0, 140)}…` : line;
}

async function buildLayer4Text(courseId: string | null, rung: HintRung | null): Promise<string> {
  let instructions: string | null = null;
  if (courseId) {
    const [c] = await db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
    instructions = c?.instructions ?? null;
  }
  return buildLayer4(rung, instructions);
}

/**
 * LAYER 5 — live conversation history. Recent turns raw and verbatim; older
 * turns collapsed at a compact boundary into a written summary. The full raw
 * transcript always remains retrievable underneath — nothing is deleted (§4).
 */
async function buildLayer5(
  userId: string, chatId: string, rawTurnLimit: number,
): Promise<{ text: string; messages: Message[] }> {
  const [chat] = await db
    .select().from(chats)
    .where(and(eq(chats.id, chatId), eq(chats.userId, userId)))
    .limit(1);
  if (!chat) throw new Error(`chat ${chatId} not found for user`);

  const [boundary] = await db
    .select().from(compactionBoundaries)
    .where(eq(compactionBoundaries.chatId, chatId))
    .orderBy(desc(compactionBoundaries.createdAt))
    .limit(1);

  const recent = await db
    .select().from(messages)
    .where(eq(messages.chatId, chatId))
    .orderBy(desc(messages.createdAt))
    .limit(rawTurnLimit);
  recent.reverse();

  const turns: Message[] = [];
  if (boundary) {
    turns.push({
      role: "system",
      content: `# Summary of earlier conversation\n${boundary.summary}`,
    });
  }
  for (const m of recent) {
    if (m.role === "system") continue;
    turns.push({ role: m.role as Message["role"], content: m.content });
  }

  return {
    text: boundary
      ? `${recent.length} raw turns after a compact boundary`
      : `${recent.length} raw turns, no compaction yet`,
    messages: turns,
  };
}
