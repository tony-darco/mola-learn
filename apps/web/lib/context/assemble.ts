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
import { and, asc, desc, eq, gte, lt } from "drizzle-orm";
import type { HintRung } from "@mola/shared";
import {
  chats, compactionBoundaries, courses, db, documents, messages, tasks, users,
} from "@mola/db";
import type { Message } from "../llm/types";
import type { ToolRegistry } from "../agent/registry";
// Layer 2 renders schedule rows the same way `read_schedule` reports them, so
// both come from one place (lib/agent/tools/calendar.ts) rather than two
// formatters that have to be kept in agreement by hand.
import {
  addDays, formatDayShort, formatNow, formatTime, formatWeekday, loadCurrentPlan,
  loadScheduleWindow, localDateKey, readPlanItems, startOfLocalDay, startOfLocalWeek,
  type ScheduleRow,
} from "../agent/tools/calendar";
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
 *
 * This block is stamped into EVERY request, so it summarises rather than
 * dumps. What earns a line is what would change the tutor's answer: what the
 * student committed to today, what is due or sat before Sunday, and the
 * milestones past it. Lectures and standing commitments collapse into a count
 * — that Thursday is busy matters, the room number of each lecture does not.
 *
 * Nothing here is inferred. A horizon with no plan says it has no plan, and
 * every date printed is a date that exists in `schedule_items`.
 *
 * Horizon boundaries: today, the rest of the calendar week, then everything
 * after it. §5's semester horizon is "two weeks out and beyond", but cutting
 * there would drop days 8–14 — in the fixture, exactly the week holding two
 * colliding deadlines — so Semester picks up where This week ends and is
 * filtered to milestones instead.
 */
async function buildLayer2(userId: string): Promise<string> {
  const now = new Date();
  const todayStart = startOfLocalDay(now);
  const tomorrow = addDays(todayStart, 1);
  const weekEnd = addDays(startOfLocalWeek(now), 7);
  const semesterEnd = addDays(todayStart, 120);

  const [today, rest, beyond, dayPlan, weekPlan, semesterPlan, todayTasks] = await Promise.all([
    loadScheduleWindow(userId, todayStart, tomorrow),
    loadScheduleWindow(userId, tomorrow, weekEnd),
    loadScheduleWindow(userId, weekEnd, semesterEnd),
    loadCurrentPlan(userId, "day", todayStart),
    loadCurrentPlan(userId, "week", todayStart),
    loadCurrentPlan(userId, "semester", todayStart),
    db.select().from(tasks).where(and(
      eq(tasks.userId, userId),
      gte(tasks.scheduledFor, todayStart),
      lt(tasks.scheduledFor, tomorrow),
    )).limit(30),
  ]);

  const lines = ["# Schedule", `Now: ${formatNow(now)}.`];
  if (!dayPlan && !weekPlan && !semesterPlan) {
    lines.push(
      today.length + rest.length + beyond.length === 0
        ? "No study plan has been proposed yet, and the calendar is empty."
        : "No study plan has been proposed yet — what follows is the calendar only.",
    );
  }

  lines.push("", "## Today");
  if (dayPlan) {
    const read = readPlanItems(dayPlan);
    lines.push(read?.summary
      ? `Day plan (${dayPlan.status}): ${read.summary}`
      : `Day plan: ${dayPlan.status}.`);
    const open = todayTasks.filter((t) => t.status === "todo");
    if (open.length) {
      lines.push(`To do: ${open.slice(0, 6).map(taskLine).join("; ")}.`);
    }
    const done = todayTasks.length - open.length;
    if (todayTasks.length) lines.push(`${done} of ${todayTasks.length} done.`);
  } else {
    lines.push("No day plan for today yet.");
  }
  lines.push(...todayLines(today));

  lines.push("", `## This week (through ${formatWeekday(addDays(weekEnd, -1))} ${monthDay(addDays(weekEnd, -1))})`);
  if (weekPlan) {
    const read = readPlanItems(weekPlan);
    lines.push(`Week plan (${weekPlan.status})${read?.summary ? `: ${read.summary}` : "."}`);
  } else {
    lines.push("No week plan yet.");
  }
  lines.push(...weekLines(rest));

  lines.push("", "## Semester");
  if (semesterPlan) lines.push(`Semester plan: ${semesterPlan.status}.`);
  lines.push(...semesterLines(beyond, now));

  return lines.join("\n");
}

/** A schedule row is a milestone if missing it costs the student marks. */
function isMilestone(r: ScheduleRow): boolean {
  return r.kind === "exam" || r.kind === "assignment" || r.kind === "deadline";
}

function todayLines(today: ScheduleRow[]): string[] {
  if (today.length === 0) return ["Nothing on the calendar today."];
  const due = today.filter((r) => isMilestone(r) && !r.completedAt);
  const rest = today.filter((r) => !isMilestone(r));
  return [
    due.length ? `Due today: ${due.map(describe).join("; ")}.` : "Nothing due today.",
    ...(rest.length ? [`Also today: ${rest.slice(0, 4).map(describe).join("; ")}.`] : []),
  ];
}

function weekLines(rest: ScheduleRow[]): string[] {
  const milestones = rest.filter((r) => isMilestone(r) && !r.completedAt);
  if (milestones.length === 0 && rest.length === 0) return ["Nothing else on the calendar this week."];

  const out = groupByDay(milestones).map(([day, rows]) =>
    `${formatWeekday(day)}: ${rows.map(describe).join("; ")}.`);
  if (milestones.length === 0) out.push("No deadlines or exams left this week.");

  const classes = rest.filter((r) => r.kind === "class").length;
  const other = rest.length - classes - milestones.length;
  const also = [
    classes ? `${classes} ${classes === 1 ? "class" : "classes"}` : null,
    other > 0 ? `${other} other ${other === 1 ? "commitment" : "commitments"}` : null,
  ].filter(Boolean);
  if (also.length) out.push(`Plus ${also.join(" and ")}.`);
  return out;
}

function semesterLines(beyond: ScheduleRow[], now: Date): string[] {
  const milestones = beyond.filter((r) => isMilestone(r) && !r.completedAt);
  if (milestones.length === 0) return ["Nothing scheduled beyond this week."];

  const days = groupByDay(milestones);
  const shown = days.slice(0, 6).map(([day, rows]) =>
    `${formatDayShort(day)}${day.getFullYear() === now.getFullYear() ? "" : ` ${day.getFullYear()}`}`
    + `: ${rows.map(describe).join("; ")}.`);
  const hidden = days.length - 6;
  if (hidden > 0) shown.push(`Plus ${hidden} more dated ${hidden === 1 ? "item" : "items"} further out.`);
  return shown;
}

/** Rows bucketed by local day, in date order — one line per day, so two
 *  deadlines landing together read as the collision they are. */
function groupByDay(rows: ScheduleRow[]): [Date, ScheduleRow[]][] {
  const buckets = new Map<string, { day: Date; rows: ScheduleRow[] }>();
  for (const r of rows) {
    if (!r.when) continue;
    const key = localDateKey(r.when);
    const bucket = buckets.get(key) ?? { day: startOfLocalDay(r.when), rows: [] };
    bucket.rows.push(r);
    buckets.set(key, bucket);
  }
  return [...buckets.values()]
    .sort((a, b) => a.day.getTime() - b.day.getTime())
    .map((b) => [b.day, b.rows] as [Date, ScheduleRow[]]);
}

function describe(r: ScheduleRow): string {
  const title = withCourse(r.title, r.courseNumber);
  if (!r.when || r.allDay === 1) return title;
  const time = formatTime(r.when);
  return isMilestone(r) && r.kind !== "exam" ? `${title} due ${time}` : `${title} ${time}`;
}

/** Feed titles already carry the course number; chat-added ones ("Essay draft")
 *  do not, and the tutor needs to know which course it belongs to. */
function withCourse(title: string, courseNumber: string | null): string {
  const trimmed = title.length > 70 ? `${title.slice(0, 69)}…` : title;
  if (!courseNumber || trimmed.toLowerCase().includes(courseNumber.toLowerCase())) return trimmed;
  return `${courseNumber} ${trimmed}`;
}

function taskLine(t: typeof tasks.$inferSelect): string {
  return t.estimatedMinutes ? `${t.title} (${t.estimatedMinutes}m)` : t.title;
}

function monthDay(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(d);
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
