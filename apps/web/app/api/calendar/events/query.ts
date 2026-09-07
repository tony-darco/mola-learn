/**
 * The read model behind contract D's two events endpoints.
 *
 * Lives beside the route rather than in `lib/calendar/` because that tree
 * belongs to the ingestion workstream (J1); everything here is read-only
 * projection of rows J1 writes.
 *
 * The one rule worth stating: a schedule item's time is `startAt ?? dueAt`.
 * A pure deadline carries only `dueAt`, a lecture carries a span, and the
 * calendar must never branch on `kind` to work out which — so the branch
 * happens exactly once, here, and every caller downstream sees `start`.
 */
import { and, eq, sql } from "drizzle-orm";
import { courses, db, scheduleItems } from "@mola/db";
import type { CalendarEvent } from "@mola/shared";

/** The subset of a `schedule_items` row the projection actually reads. */
export type ScheduleItemRow = {
  id: string;
  title: string;
  kind: CalendarEvent["kind"];
  source: CalendarEvent["source"];
  courseId: string | null;
  startAt: Date | null;
  endAt: Date | null;
  dueAt: Date | null;
  allDay: number;
  location: string | null;
  description: string | null;
  completedAt: Date | null;
};

/** SQL for the same `startAt ?? dueAt` rule, so the window filter and the
 * projection can never disagree about when an item happens. */
const START_EXPR = sql`coalesce(${scheduleItems.startAt}, ${scheduleItems.dueAt})`;
const END_EXPR = sql`coalesce(${scheduleItems.endAt}, ${scheduleItems.startAt}, ${scheduleItems.dueAt})`;

export function toCalendarEvent(row: ScheduleItemRow, courseName: string | null): CalendarEvent | null {
  const start = row.startAt ?? row.dueAt;
  // Neither column set means the row has no place on a calendar at all. The
  // window query already excludes these; returning null keeps the projection
  // total rather than throwing on a row a caller passed in directly.
  if (!start) return null;

  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    source: row.source,
    courseId: row.courseId,
    courseName,
    start: start.toISOString(),
    end: row.endAt ? row.endAt.toISOString() : null,
    allDay: row.allDay === 1,
    location: row.location,
    description: row.description,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

const SELECTION = {
  id: scheduleItems.id,
  title: scheduleItems.title,
  kind: scheduleItems.kind,
  source: scheduleItems.source,
  courseId: scheduleItems.courseId,
  startAt: scheduleItems.startAt,
  endAt: scheduleItems.endAt,
  dueAt: scheduleItems.dueAt,
  allDay: scheduleItems.allDay,
  location: scheduleItems.location,
  description: scheduleItems.description,
  completedAt: scheduleItems.completedAt,
  courseName: courses.name,
} as const;

/**
 * Every event the caller owns that overlaps `[from, to)`.
 *
 * Overlap, not containment: a lecture that started before the window still
 * belongs on the first day of it, and a week view that dropped Monday's
 * 9:50-ending class because the fetch began at 10:00 would be wrong.
 */
export async function listCalendarEvents(
  userId: string,
  opts: { from: Date; to: Date; courseId?: string | null },
): Promise<CalendarEvent[]> {
  const rows = await db
    .select(SELECTION)
    .from(scheduleItems)
    .leftJoin(courses, eq(scheduleItems.courseId, courses.id))
    .where(and(
      eq(scheduleItems.userId, userId),
      sql`${START_EXPR} < ${opts.to.toISOString()}`,
      sql`${END_EXPR} >= ${opts.from.toISOString()}`,
      opts.courseId ? eq(scheduleItems.courseId, opts.courseId) : undefined,
    ))
    .orderBy(START_EXPR);

  return rows
    .map((r) => toCalendarEvent(r, r.courseName))
    .filter((e): e is CalendarEvent => e !== null);
}

/** One event by id, already scoped to its owner. Used to re-project a row the
 * PATCH route just wrote, so the response carries the same shape as the list. */
export async function getCalendarEvent(userId: string, id: string): Promise<CalendarEvent | null> {
  const [row] = await db
    .select(SELECTION)
    .from(scheduleItems)
    .leftJoin(courses, eq(scheduleItems.courseId, courses.id))
    .where(and(eq(scheduleItems.id, id), eq(scheduleItems.userId, userId)))
    .limit(1);

  return row ? toCalendarEvent(row, row.courseName) : null;
}
