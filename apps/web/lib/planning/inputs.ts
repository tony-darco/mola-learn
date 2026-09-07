/**
 * What the planner is allowed to know, and how it is written down for the model.
 *
 * The point of this file is that a plan is only as good as the facts under it:
 * a planner that is handed courses but not the work shift on Tuesday evening
 * will book three hours of study on top of that shift, and a planner that is
 * handed the shift but not the quiz on Thursday will happily leave Thursday
 * empty. So the brief always carries all four: the courses and how the student
 * asked to be taught, every committed block in the horizon, the deadlines and
 * sittings in it, and what has already been finished.
 */
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { courses, db, plans, scheduleItems, tasks, terms, users } from "@mola/db";
import { dateKey, timeRangeLabel, weekdayName } from "./dates";

export type ScheduleRow = typeof scheduleItems.$inferSelect;
export type CourseRow = typeof courses.$inferSelect;
export type PlanRow = typeof plans.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;

/**
 * Kinds that occupy a block of time the student cannot study through. A
 * deadline is not one of these — it is a moment, not an occupation — which is
 * why this switches on kind AND on actually having a span.
 */
const OCCUPYING_KINDS = new Set(["class", "exam", "event", "study_session", "recurring_task"]);

export function isCommitted(row: ScheduleRow): boolean {
  return OCCUPYING_KINDS.has(row.kind) && row.startAt !== null && row.endAt !== null;
}

/** `coalesce(start_at, due_at)` — the render rule from contract A, as a sort/filter key. */
const whenExpr = sql`coalesce(${scheduleItems.startAt}, ${scheduleItems.dueAt})`;

export function whenOf(row: ScheduleRow): Date | null {
  return row.startAt ?? row.dueAt ?? null;
}

export type PlannerInputs = {
  studentName: string;
  termLabel: string | null;
  today: string;
  courses: CourseRow[];
  /** Everything in the horizon window, ordered by `startAt ?? dueAt`. */
  events: ScheduleRow[];
  /** Recently finished work, so the planner does not re-plan it. */
  completed: ScheduleRow[];
  /** Tasks already checked off inside the window. */
  doneTasks: TaskRow[];
};

export async function gatherInputs(
  userId: string,
  from: Date,
  to: Date,
): Promise<PlannerInputs> {
  const [[student], myTerms, myCourses, events, completed, doneTasks] = await Promise.all([
    db.select().from(users).where(eq(users.id, userId)).limit(1),
    db.select().from(terms).where(eq(terms.userId, userId)).orderBy(asc(terms.createdAt)),
    db.select().from(courses).where(eq(courses.userId, userId)).orderBy(asc(courses.number)),
    db.select().from(scheduleItems).where(and(
      eq(scheduleItems.userId, userId),
      sql`${whenExpr} >= ${from}`,
      sql`${whenExpr} <= ${to}`,
    )).orderBy(sql`${whenExpr} asc`),
    // A fortnight back is enough to say "you already did PS3" without turning
    // the brief into a transcript of the semester.
    db.select().from(scheduleItems).where(and(
      eq(scheduleItems.userId, userId),
      sql`${scheduleItems.completedAt} is not null`,
      gte(scheduleItems.completedAt, new Date(from.getTime() - 14 * 86_400_000)),
    )).orderBy(asc(scheduleItems.completedAt)),
    db.select().from(tasks).where(and(
      eq(tasks.userId, userId),
      eq(tasks.status, "done"),
      gte(tasks.scheduledFor, new Date(from.getTime() - 14 * 86_400_000)),
      lte(tasks.scheduledFor, to),
    )).orderBy(asc(tasks.scheduledFor)),
  ]);

  return {
    studentName: student?.name ?? "the student",
    termLabel: myTerms.at(-1)?.label ?? null,
    today: dateKey(new Date()),
    courses: myCourses,
    events,
    completed,
    doneTasks,
  };
}

// ── Rendering ────────────────────────────────────────────────────────────────

export function renderCourses(rows: CourseRow[]): string {
  if (rows.length === 0) return "COURSES: none enrolled.";
  return ["COURSES (use these ids verbatim, or null):", ...rows.map((c) => {
    const head = `- id=${c.id} · ${c.number ?? c.name}${c.number ? ` — ${c.name}` : ""}`
      + (c.professor ? ` (${c.professor})` : "");
    const lines = [head];
    if (c.summary) lines.push(`  about: ${c.summary}`);
    if (c.instructions) lines.push(`  how the student wants to be taught: ${c.instructions}`);
    return lines.join("\n");
  })].join("\n");
}

/**
 * The calendar, one line per row, grouped by day and tagged BUSY where the
 * block is already spent. The tag is doing real work: it is the difference
 * between a plan that books Tuesday evening for reading and one that notices
 * the student is at the library desk until 8.
 */
export function renderCalendar(rows: ScheduleRow[], courseRows: CourseRow[], heading: string): string {
  if (rows.length === 0) return `${heading}: nothing on the calendar.`;

  const label = courseLabeller(courseRows);
  const byDay = new Map<string, string[]>();

  for (const row of rows) {
    const when = whenOf(row);
    if (!when) continue;
    const key = dateKey(when);
    const time = row.allDay === 1 ? "all day" : timeRangeLabel(when, row.endAt);
    const busy = isCommitted(row) ? "  [BUSY — cannot study through this]" : "";
    const due = row.kind === "assignment" || row.kind === "deadline" ? "  [DUE]" : "";
    const line = `    ${time.padEnd(13)} ${row.kind.padEnd(11)} ${label(row.courseId)}${row.title}`
      + (row.location ? ` @ ${row.location}` : "")
      + `  (scheduleItemId=${row.id})${busy}${due}`;
    const bucket = byDay.get(key) ?? [];
    bucket.push(line);
    byDay.set(key, bucket);
  }

  const days = [...byDay.entries()].map(([key, lines]) =>
    `  ${weekdayName(key)} ${key}\n${lines.join("\n")}`);
  return `${heading}:\n${days.join("\n")}`;
}

export function renderCompleted(inputs: PlannerInputs): string {
  const label = courseLabeller(inputs.courses);
  const lines = [
    ...inputs.completed.map((r) => `  - ${label(r.courseId)}${r.title} — finished`),
    ...inputs.doneTasks.map((t) => `  - ${label(t.courseId)}${t.title} — finished`),
  ];
  if (lines.length === 0) return "ALREADY DONE: nothing recorded yet.";
  return `ALREADY DONE (do not plan this work again):\n${lines.join("\n")}`;
}

export function renderPlanForPrompt(plan: PlanRow | null, heading: string): string {
  if (!plan) return `${heading}: none yet.`;
  return `${heading} (status ${plan.status}):\n${JSON.stringify(plan.payload)}`;
}

function courseLabeller(rows: CourseRow[]): (courseId: string | null) => string {
  const byId = new Map(rows.map((c) => [c.id, c.number ?? c.name]));
  return (courseId) => (courseId ? `${byId.get(courseId) ?? "course"} · ` : "");
}

/** The ids the model is allowed to point `relatedScheduleItemId` at. */
export function scheduleItemIds(rows: ScheduleRow[]): Set<string> {
  return new Set(rows.map((r) => r.id));
}
