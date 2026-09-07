/**
 * Feed event → `schedule_items` shape.
 *
 * The two judgement calls live here: what kind of thing an event is, and which
 * course it belongs to. Both are deliberately conservative. A feed row that is
 * mis-filed under the wrong course is worse than one filed under none — the
 * planner reasons over `courseId`, so a wrong guess quietly puts an OS deadline
 * into the Linear Algebra workload and the student has no way to see why.
 */
import type { FeedEvent } from "./types";
import type { IcsEvent } from "./ics";

export type ScheduleKind =
  | "deadline" | "recurring_task" | "study_session" | "class" | "exam" | "assignment" | "event";

/** Course rows as far as matching is concerned. */
export type CourseRef = { id: string; number: string | null };

// Ordered: the first hit wins, so "Quiz 2" lands on exam rather than on the
// looser assignment pattern below it.
const EXAM = /\b(exam|midterm|final|finals|quiz|test)\b/i;
const ASSIGNMENT = /\b(assignment|homework|hw\s*\d|problem\s*set|ps\s*\d|project|lab\s*\d|essay|paper|report|submission|submit|worksheet)\b/i;
const DEADLINE = /\b(due|deadline)\b/i;
const CLASS = /\b(lecture|lab|seminar|recitation|discussion|section|class|studio)\b/i;

/**
 * `title` carries most of the signal; `description` is consulted only for the
 * assignment and deadline patterns, because a Blackboard event's description
 * routinely contains the word "lecture" in unrelated boilerplate.
 */
export function inferKind(
  title: string,
  description: string | null,
  opts: { hasSpan: boolean; hasRrule: boolean },
): ScheduleKind {
  if (EXAM.test(title)) return "exam";
  if (ASSIGNMENT.test(title) || (description !== null && ASSIGNMENT.test(description))) return "assignment";
  if (DEADLINE.test(title) || (description !== null && DEADLINE.test(description))) return "deadline";
  if (CLASS.test(title)) return "class";
  // A repeating timed block with no other signal is a standing commitment —
  // a class meeting far more often than anything else in a student's feed.
  if (opts.hasRrule && opts.hasSpan) return "class";
  return "event";
}

/**
 * "CMSC 421", "CMSC421", "MATH-221H". Deliberately narrow: a bare number, or a
 * word that merely looks like a subject, is not enough.
 */
const COURSE_NUMBER = /\b([A-Za-z]{2,5})\s*[-\s]?\s*(\d{3}[A-Za-z]?)\b/g;

function normalizeNumber(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

/**
 * The course this event belongs to, or null.
 *
 * Null on ambiguity as well as on no-match: an event naming two course numbers
 * ("CMSC 421 / CMSC 441 joint review") belongs to neither as far as the
 * planner is concerned, and picking the first one would be a guess.
 */
export function matchCourseId(
  title: string,
  description: string | null,
  courses: readonly CourseRef[],
): string | null {
  const haystack = description ? `${title}\n${description}` : title;
  const wanted = new Set<string>();
  for (const [, subject, number] of haystack.matchAll(COURSE_NUMBER)) {
    wanted.add(normalizeNumber(`${subject}${number}`));
  }
  if (wanted.size === 0) return null;

  const hits = new Set<string>();
  for (const course of courses) {
    if (!course.number) continue;
    if (wanted.has(normalizeNumber(course.number))) hits.add(course.id);
  }
  return hits.size === 1 ? [...hits][0]! : null;
}

/**
 * ICS → the normalised feed shape.
 *
 * `externalId` is the UID, except on an overridden instance of a recurring
 * series, where the UID is shared with the master event. Without the
 * RECURRENCE-ID suffix the two collide on `(userId, source, externalId)` and
 * the override silently overwrites the series.
 */
export function mapIcsEvent(event: IcsEvent): FeedEvent {
  const externalId = event.recurrenceId ? `${event.uid}#${event.recurrenceId}` : event.uid;
  const kind = inferKind(event.summary, event.description, {
    hasSpan: event.end !== null && !event.allDay,
    hasRrule: event.rrule !== null,
  });

  return {
    externalId,
    title: event.summary,
    description: event.description,
    location: event.location,
    ...placement(kind, event.start, event.end, event.allDay),
    allDay: event.allDay,
    rrule: event.rrule,
    externalUpdatedAt: event.lastModified,
    cancelled: event.status === "CANCELLED",
  };
}

/**
 * Where the event's time goes.
 *
 * Contract A: "a pure deadline sets only `dueAt`; a span sets
 * `startAt`/`endAt`", and the calendar renders `startAt ?? dueAt`. A span also
 * stamps `dueAt` so a due-date query still sees it, matching what
 * `seed-calendar.ts` writes.
 */
export function placement(
  kind: ScheduleKind, start: Date | null, end: Date | null, allDay: boolean,
): Pick<FeedEvent, "startAt" | "endAt" | "dueAt"> {
  const isPointInTime = start !== null && (end === null || end.getTime() <= start.getTime());
  if ((kind === "deadline" || kind === "assignment") && isPointInTime && !allDay) {
    return { startAt: null, endAt: null, dueAt: start };
  }
  return { startAt: start, endAt: end, dueAt: start };
}
