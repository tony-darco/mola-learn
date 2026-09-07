/**
 * Agent J5 — the four conversation-facing schedule tools (contract E), plus the
 * date primitives Layer 2 renders with (contract F).
 *
 * Both live here on purpose: a `read_schedule` result and the Schedule block
 * stamped into the same request's context must not disagree about what
 * "Thursday 11:59pm" means, and two copies of a time formatter drift.
 *
 * Ownership (§9): every query carries `eq(userId, ctx.session.userId)` in its
 * own WHERE, which gives `requireOwned`'s property directly — a foreign id and
 * a missing id both come back as no row, so neither can be used to probe which
 * ids exist. Contract 2's `OwnedKind` has no `scheduleItem`/`plan`/`task`
 * member to call and that file is frozen; the one place it does apply — a
 * courseId handed in by the model — goes through it.
 */
import { z } from "zod";
import { and, asc, desc, eq, gt, isNull, lte, ne, or, sql } from "drizzle-orm";
import { courses, db, planAmendments, plans, scheduleItems, tasks } from "@mola/db";
import {
  dayPlanPayloadSchema, weekPlanPayloadSchema, type PlannedItem,
} from "@mola/shared";
import { AuthzError, requireOwned } from "../../auth/ownership";
import type { Tool, ToolContext } from "../registry";

// ── Local-day primitives ─────────────────────────────────────────────────────
//
// A student's day is a wall-clock day. Slicing on a UTC boundary puts an
// 11:59pm deadline on the wrong date for everyone west of Greenwich, and
// `DayPlanPayload.date` is already specified as local (contract B). There is no
// per-user timezone column yet, so "local" is the server's zone; when one
// lands, these four functions are the only place that has to learn about it.

const DAY_MS = 86_400_000;

export function startOfLocalDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

export function addDays(d: Date, n: number): Date {
  return startOfLocalDay(new Date(d.getTime() + n * DAY_MS));
}

/** Monday of `d`'s week. Sunday belongs to the week that just ended. */
export function startOfLocalWeek(d: Date): Date {
  const day = startOfLocalDay(d);
  return addDays(day, day.getDay() === 0 ? -6 : 1 - day.getDay());
}

/** YYYY-MM-DD in local time — never `toISOString()`, which is UTC. */
export function localDateKey(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Local midnight for a YYYY-MM-DD key, or null if it is not a real date. */
export function parseLocalDate(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const out = new Date(y, mo - 1, d, 0, 0, 0, 0);
  // Rejects 2026-02-31, which the Date constructor would happily roll forward.
  return out.getMonth() === mo - 1 && out.getDate() === d ? out : null;
}

// ── Formatting ───────────────────────────────────────────────────────────────

const TIME_FMT = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const WEEKDAY_FMT = new Intl.DateTimeFormat("en-US", { weekday: "long" });
const DAY_FMT = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" });
const NOW_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "long", month: "long", day: "numeric", year: "numeric",
});

/** "11:59 PM" → "11:59pm". The separator ICU emits is U+202F, not a space. */
export function formatTime(d: Date): string {
  return TIME_FMT.format(d).replace(/\s+/g, "").toLowerCase();
}

export function formatWeekday(d: Date): string {
  return WEEKDAY_FMT.format(d);
}

export function formatDayShort(d: Date): string {
  return DAY_FMT.format(d);
}

export function formatNow(d: Date): string {
  return `${NOW_FMT.format(d)}, ${formatTime(d)}`;
}

/** Absolute and self-contained — what a tool result carries, where the reader
 *  has no surrounding week to anchor "Thursday" against. */
export function formatWhen(when: Date, allDay: boolean, now = new Date()): string {
  const date = formatDayShort(when);
  const year = when.getFullYear() === now.getFullYear() ? "" : ` ${when.getFullYear()}`;
  return allDay ? `${date}${year} (all day)` : `${date}${year}, ${formatTime(when)}`;
}

// ── Reads ────────────────────────────────────────────────────────────────────

/** A pure deadline carries only `dueAt`; a span carries `startAt` (contract A). */
const WHEN = sql<Date>`coalesce(${scheduleItems.startAt}, ${scheduleItems.dueAt})`;

export type ScheduleRow = {
  id: string;
  title: string;
  kind: typeof scheduleItems.$inferSelect["kind"];
  source: typeof scheduleItems.$inferSelect["source"];
  courseId: string | null;
  courseNumber: string | null;
  when: Date | null;
  endAt: Date | null;
  allDay: number;
  location: string | null;
  completedAt: Date | null;
};

export async function loadScheduleWindow(
  userId: string, from: Date, to: Date, courseId?: string | null,
): Promise<ScheduleRow[]> {
  const rows = await db
    .select({
      id: scheduleItems.id,
      title: scheduleItems.title,
      kind: scheduleItems.kind,
      source: scheduleItems.source,
      courseId: scheduleItems.courseId,
      courseNumber: courses.number,
      when: WHEN,
      endAt: scheduleItems.endAt,
      allDay: scheduleItems.allDay,
      location: scheduleItems.location,
      completedAt: scheduleItems.completedAt,
    })
    .from(scheduleItems)
    .leftJoin(courses, eq(courses.id, scheduleItems.courseId))
    .where(and(
      eq(scheduleItems.userId, userId),
      // ISO strings, not Dates: a Date bound through a raw `sql` fragment
      // bypasses drizzle's column mapper and postgres.js cannot serialise it.
      sql`coalesce(${scheduleItems.startAt}, ${scheduleItems.dueAt}) >= ${from.toISOString()}`,
      sql`coalesce(${scheduleItems.startAt}, ${scheduleItems.dueAt}) < ${to.toISOString()}`,
      ...(courseId ? [eq(scheduleItems.courseId, courseId)] : []),
    ))
    .orderBy(asc(WHEN))
    .limit(200);

  // `WHEN` is nullable in the type system (both columns are), but a row with
  // neither a start nor a due time cannot match the window predicate above.
  return rows.map((r) => ({ ...r, when: r.when ? new Date(r.when) : null }));
}

export type PlanRow = typeof plans.$inferSelect;

/**
 * The plan governing `date` for a horizon — the one whose period contains it,
 * newest first. `superseded` is excluded; a `proposed` one is returned because
 * an unaccepted proposal is exactly what §5 wants surfaced on next open.
 */
export async function loadCurrentPlan(
  userId: string, horizon: "day" | "week" | "semester", date: Date,
): Promise<PlanRow | null> {
  const [row] = await db
    .select().from(plans)
    .where(and(
      eq(plans.userId, userId),
      eq(plans.horizon, horizon),
      ne(plans.status, "superseded"),
      lte(plans.periodStart, date),
      or(isNull(plans.periodEnd), gt(plans.periodEnd, date)),
    ))
    .orderBy(desc(plans.periodStart), desc(plans.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * Plan payloads are LLM-produced, so they are parsed at this boundary rather
 * than trusted (contract B). A malformed one degrades to null: Layer 2 is
 * stamped into every request and must not be able to throw.
 */
export function readPlanItems(plan: PlanRow): { summary: string | null; items: PlannedItem[] } | null {
  if (plan.horizon === "day") {
    const parsed = dayPlanPayloadSchema.safeParse(plan.payload);
    if (!parsed.success) return null;
    return { summary: parsed.data.summary ?? null, items: parsed.data.items };
  }
  if (plan.horizon === "week") {
    const parsed = weekPlanPayloadSchema.safeParse(plan.payload);
    if (!parsed.success) return null;
    return { summary: parsed.data.summary, items: parsed.data.days.flatMap((d) => d.items) };
  }
  return null;
}

// ── read_schedule ────────────────────────────────────────────────────────────

const readScheduleInput = z.object({
  from: z.string().optional().describe("Start of the window, YYYY-MM-DD. Defaults to today."),
  to: z.string().optional().describe("End of the window, inclusive, YYYY-MM-DD. Defaults to 14 days out."),
  courseId: z.string().uuid().optional().describe("Restrict to one course."),
});

export const readScheduleTool: Tool<z.infer<typeof readScheduleInput>> = {
  name: "read_schedule",
  description: "Read the student's upcoming classes, deadlines and exams in a date window.",
  inputSchema: readScheduleInput,
  label: (input) => (input.from ? `Reading schedule from ${input.from}` : "Reading upcoming schedule"),

  async execute(input, ctx) {
    const now = new Date();
    const from = input.from ? parseLocalDate(input.from) : startOfLocalDay(now);
    const toDay = input.to ? parseLocalDate(input.to) : addDays(now, 14);
    if (!from || !toDay) {
      return { error: "from and to must be calendar dates in YYYY-MM-DD form." };
    }
    if (input.courseId) {
      const denied = await checkCourse(input.courseId, ctx);
      if (denied) return denied;
    }

    const rows = await loadScheduleWindow(ctx.session.userId, from, addDays(toDay, 1), input.courseId);
    const window = `${formatDayShort(from)} – ${formatDayShort(toDay)}`;
    if (rows.length === 0) return { window, events: [], note: "Nothing on the calendar in that window." };

    return {
      window,
      events: rows.map((r) => ({
        id: r.id,
        title: r.title,
        kind: r.kind,
        course: r.courseNumber,
        when: r.when ? formatWhen(r.when, r.allDay === 1, now) : null,
        location: r.location,
        completed: r.completedAt !== null,
      })),
    };
  },
};

// ── read_plan ────────────────────────────────────────────────────────────────

const readPlanInput = z.object({
  horizon: z.enum(["day", "week"]).describe("Which plan to read"),
  date: z.string().optional().describe("A day inside the plan's period, YYYY-MM-DD. Defaults to today."),
});

export const readPlanTool: Tool<z.infer<typeof readPlanInput>> = {
  name: "read_plan",
  description: "Read the student's current day or week study plan and the items in it.",
  inputSchema: readPlanInput,
  label: (input) => `Reading the ${input.horizon} plan`,

  async execute(input, ctx) {
    const date = input.date ? parseLocalDate(input.date) : startOfLocalDay(new Date());
    if (!date) return { error: "date must be a calendar date in YYYY-MM-DD form." };

    const plan = await loadCurrentPlan(ctx.session.userId, input.horizon, date);
    if (!plan) {
      return {
        horizon: input.horizon,
        plan: null,
        note: `No ${input.horizon} plan covers ${localDateKey(date)}. Do not invent one — offer to propose it.`,
      };
    }

    const read = readPlanItems(plan);
    if (!read) {
      return { horizon: input.horizon, plan: null, note: "The stored plan payload is malformed and cannot be read." };
    }

    const rows = await db
      .select({
        id: tasks.id, title: tasks.title, status: tasks.status,
        planItemId: tasks.planItemId, scheduledFor: tasks.scheduledFor,
        estimatedMinutes: tasks.estimatedMinutes,
      })
      .from(tasks)
      .where(and(eq(tasks.userId, ctx.session.userId), eq(tasks.planId, plan.id)))
      .orderBy(asc(tasks.scheduledFor));

    return {
      horizon: plan.horizon,
      status: plan.status,
      period: `${formatDayShort(plan.periodStart)}${plan.periodEnd ? ` – ${formatDayShort(plan.periodEnd)}` : ""}`,
      summary: read.summary,
      items: read.items.map((i) => ({
        id: i.id,
        title: i.title,
        kind: i.kind,
        estimatedMinutes: i.estimatedMinutes ?? null,
        rationale: i.rationale ?? null,
      })),
      tasks: rows.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        scheduledFor: t.scheduledFor ? formatDayShort(t.scheduledFor) : null,
        estimatedMinutes: t.estimatedMinutes,
      })),
    };
  },
};

// ── add_schedule_item ────────────────────────────────────────────────────────

const addScheduleItemInput = z.object({
  title: z.string().min(1).describe("What the item is, in the student's own words"),
  date: z.string().describe(
    "The calendar date, YYYY-MM-DD. Pass only a day the student actually named. "
    + "If they were vague (\"sometime next week\", \"before the exam\"), pass what they said verbatim.",
  ),
  time: z.string().optional().describe("Local clock time, HH:MM (24h). Omit if the student did not give one."),
  endTime: z.string().optional().describe("Local end time, HH:MM (24h), for something that occupies a span."),
  kind: z.enum(["deadline", "assignment", "exam", "class", "study_session", "event"])
    .describe("What sort of item it is"),
  courseId: z.string().uuid().optional().describe("The course it belongs to, if any"),
  location: z.string().optional(),
  description: z.string().optional(),
});

export const addScheduleItemTool: Tool<z.infer<typeof addScheduleItemInput>> = {
  name: "add_schedule_item",
  description:
    "Record a date the student mentioned in conversation onto their calendar. Requires an exact day — "
    + "it will ask rather than guess if the date is vague.",
  inputSchema: addScheduleItemInput,
  label: (input) => `Adding "${input.title}" to the schedule`,

  async execute(input, ctx) {
    const day = parseLocalDate(input.date);
    if (!day) {
      // The whole point of the tool refusing here: a deadline silently filed on
      // the wrong Tuesday is worse than one more question (contract E).
      return {
        needsClarification: true,
        received: input.date,
        question:
          `"${input.date}" is not a specific calendar day, so nothing was recorded. `
          + "If the student named a determinate day (\"tomorrow\", \"this Friday\"), work it out from the "
          + "current date in your context and call again with YYYY-MM-DD. If they were genuinely vague, "
          + "ask them which day before recording anything.",
      };
    }

    const start = applyClock(day, input.time);
    if (start === null) return { error: "time must be a 24-hour clock time in HH:MM form." };
    const end = input.endTime ? applyClock(day, input.endTime) : null;
    if (input.endTime && end === null) return { error: "endTime must be a 24-hour clock time in HH:MM form." };

    if (input.courseId) {
      const denied = await checkCourse(input.courseId, ctx);
      if (denied) return denied;
    }

    const allDay = input.time ? 0 : 1;
    const isDeadline = input.kind === "deadline" || input.kind === "assignment";

    const [row] = await db.insert(scheduleItems).values({
      userId: ctx.session.userId,
      courseId: input.courseId ?? ctx.courseId ?? null,
      kind: input.kind,
      source: "chat",
      title: input.title,
      // Contract A: a pure deadline sets only dueAt, a span sets startAt/endAt.
      dueAt: isDeadline ? start : null,
      startAt: isDeadline ? null : start,
      endAt: isDeadline ? null : end,
      allDay,
      location: input.location ?? null,
      description: input.description ?? null,
    }).returning();

    return {
      created: {
        id: row!.id,
        title: row!.title,
        kind: row!.kind,
        when: formatWhen(start, allDay === 1),
        source: "chat",
      },
    };
  },
};

/** Local midnight when no clock time was given — an omitted time is not a
 *  licence to invent 11:59pm, so the row is stored all-day instead. */
function applyClock(day: Date, time?: string): Date | null {
  if (!time) return day;
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  const [h, min] = [Number(m[1]), Number(m[2])];
  if (h > 23 || min > 59) return null;
  const out = new Date(day);
  out.setHours(h, min, 0, 0);
  return out;
}

// ── complete_task ────────────────────────────────────────────────────────────

const completeTaskInput = z.object({
  id: z.string().uuid().optional().describe("Exact id, when a previous call returned candidates"),
  title: z.string().optional().describe("What the student said they finished, in their own words"),
});

type Candidate = {
  id: string;
  kind: "task" | "schedule_item";
  title: string;
  when: string | null;
  course: string | null;
};

export const completeTaskTool: Tool<z.infer<typeof completeTaskInput>> = {
  name: "complete_task",
  description:
    "Check off a task or assignment the student says they finished. Lists the candidates instead of "
    + "guessing when more than one matches.",
  inputSchema: completeTaskInput,
  label: (input) => `Checking off "${input.title ?? "task"}"`,

  async execute(input, ctx) {
    if (!input.id && !input.title) {
      return { error: "Pass either the id of the task, or what the student said they finished." };
    }

    const open = await loadOpenWork(ctx.session.userId);

    if (input.id) {
      const chosen = open.find((c) => c.id === input.id);
      // Scoped to this user's own open work, so an id belonging to someone else
      // is indistinguishable from one that does not exist (§9).
      if (!chosen) return { error: "No open task or assignment with that id." };
      return complete(chosen, ctx);
    }

    const matches = rank(open, input.title!);
    if (matches.length === 0) {
      return {
        completed: null,
        note: `Nothing outstanding matches "${input.title}". Ask the student which item they mean.`,
      };
    }
    if (matches.length > 1) {
      // Picking one and being wrong un-checks real work silently; saying what
      // was found costs one turn (contract E).
      return {
        ambiguous: true,
        matches,
        note: "More than one open item matches. Ask the student which, then call again with its id.",
      };
    }
    return complete(matches[0]!, ctx);
  },
};

/**
 * Outstanding work, both units: a `tasks` row is the plan's check-off unit, a
 * `schedule_items` assignment is the calendar's. A student saying "I finished
 * Problem Set 4" means whichever one their course actually put it in, so both
 * are searched rather than making them care about the distinction.
 */
async function loadOpenWork(userId: string): Promise<Candidate[]> {
  const taskRows = await db
    .select({
      id: tasks.id, title: tasks.title, scheduledFor: tasks.scheduledFor,
      courseNumber: courses.number,
    })
    .from(tasks)
    .leftJoin(courses, eq(courses.id, tasks.courseId))
    .where(and(eq(tasks.userId, userId), eq(tasks.status, "todo")))
    .limit(200);

  const itemRows = await db
    .select({
      id: scheduleItems.id, title: scheduleItems.title, when: WHEN,
      allDay: scheduleItems.allDay, courseNumber: courses.number,
    })
    .from(scheduleItems)
    .leftJoin(courses, eq(courses.id, scheduleItems.courseId))
    .where(and(
      eq(scheduleItems.userId, userId),
      isNull(scheduleItems.completedAt),
      or(eq(scheduleItems.kind, "assignment"), eq(scheduleItems.kind, "deadline")),
    ))
    .limit(200);

  return [
    ...taskRows.map((t): Candidate => ({
      id: t.id,
      kind: "task",
      title: t.title,
      when: t.scheduledFor ? formatDayShort(t.scheduledFor) : null,
      course: t.courseNumber,
    })),
    ...itemRows.map((i): Candidate => ({
      id: i.id,
      kind: "schedule_item",
      title: i.title,
      when: i.when ? formatWhen(new Date(i.when), i.allDay === 1) : null,
      course: i.courseNumber,
    })),
  ];
}

/** Everything sharing the best token overlap with the query — ties are kept, so
 *  "problem set" surfaces both problem sets rather than resolving to one. */
function rank(candidates: Candidate[], query: string): Candidate[] {
  const wanted = tokenize(query);
  if (wanted.length === 0) return [];

  let best = 0;
  const scored = candidates.map((c) => {
    const haystack = `${c.course ?? ""} ${c.title}`.toLowerCase();
    const hits = wanted.filter((w) => haystack.includes(w)).length;
    // An exact title match beats a bag-of-words tie against a longer title.
    const score = hits === 0 ? 0 : hits + (c.title.toLowerCase() === query.trim().toLowerCase() ? 100 : 0);
    best = Math.max(best, score);
    return { c, score };
  });

  if (best === 0) return [];
  return scored.filter((s) => s.score === best).map((s) => s.c);
}

const STOPWORDS = new Set([
  "the", "a", "an", "my", "i", "ive", "just", "did", "done", "finished", "completed",
  "submitted", "turned", "in", "for", "and", "of", "on", "to", "it", "that", "this",
]);

function tokenize(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

async function complete(target: Candidate, ctx: ToolContext): Promise<unknown> {
  const now = new Date();

  if (target.kind === "schedule_item") {
    await db.update(scheduleItems)
      .set({ completedAt: now, updatedAt: now })
      .where(and(eq(scheduleItems.id, target.id), eq(scheduleItems.userId, ctx.session.userId)));
    return { completed: { id: target.id, title: target.title, at: formatWhen(now, false) } };
  }

  const [row] = await db.update(tasks)
    .set({ status: "done", completedAt: now, updatedAt: now })
    .where(and(eq(tasks.id, target.id), eq(tasks.userId, ctx.session.userId)))
    .returning();
  if (!row) return { error: "No open task with that id." };

  if (row.planId && row.planItemId) {
    await recordCompletedAmendment(ctx.session.userId, row.planId, row.planItemId, row.title);
  }
  return { completed: { id: row.id, title: row.title, at: formatWhen(now, false) } };
}

/**
 * TODO(J5→J3 merge): replace this body with J3's amendment helper from
 * `lib/planning/` — one line. It is written out here only because J3 is being
 * built in parallel and that module does not exist in this worktree yet.
 *
 * The write itself is not optional: `plan_amendments` IS the §5 feedback loop,
 * and a completion that never lands there is invisible to the end-of-week
 * review even though the task shows as done.
 */
async function recordCompletedAmendment(
  userId: string, planId: string, itemId: string, title: string,
): Promise<void> {
  await db.insert(planAmendments).values({
    userId,
    planId,
    itemId,
    action: "completed",
    after: { title, completedAt: new Date().toISOString() },
    reason: "checked off in conversation",
  });
}

/** The one ownership check with a contract-2 kind behind it. */
async function checkCourse(courseId: string, ctx: ToolContext): Promise<{ error: string } | null> {
  try {
    await requireOwned("course", courseId, ctx.session);
    return null;
  } catch (e) {
    if (e instanceof AuthzError) return { error: "Course not found." };
    throw e;
  }
}
