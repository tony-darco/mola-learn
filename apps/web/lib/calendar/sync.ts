/**
 * Reconciling a feed against `schedule_items`.
 *
 * Three rules make this safe to run on a timer:
 *
 * 1. It is idempotent. A second run over an unchanged feed writes nothing at
 *    all — not even `updated_at` — so "did anything change?" stays answerable
 *    from the table instead of from a log.
 * 2. `completedAt` is never in an update. The check-off is student state, not
 *    feed state; a re-sync that clears it un-does work the student did, and it
 *    is the kind of bug nobody reports because it looks like a UI glitch.
 * 3. A partial feed never deletes. Google's incremental pages only carry what
 *    changed, so removal is gated on the caller knowing it holds the whole feed.
 */
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { courses, db, scheduleItems } from "@mola/db";
import { mapIcsEvent, matchCourseId, inferKind, type CourseRef } from "./mapping";
import { parseIcs } from "./ics";
import type { FeedEvent, SyncResult } from "./types";

type ScheduleRow = typeof scheduleItems.$inferSelect;
type FeedSource = "ics" | "google";

const EMPTY: SyncResult = { created: 0, updated: 0, skipped: 0, deleted: 0 };

export async function syncFeedEvents(input: {
  userId: string;
  source: FeedSource;
  calendarSourceId: string;
  events: readonly FeedEvent[];
  /** Only true when `events` is the complete feed — see rule 3 above. */
  removeMissing: boolean;
}): Promise<SyncResult> {
  const { userId, source, calendarSourceId, events, removeMissing } = input;
  const result = { ...EMPTY };

  const myCourses: CourseRef[] = await db
    .select({ id: courses.id, number: courses.number })
    .from(courses)
    .where(eq(courses.userId, userId));

  const live = events.filter((e) => !e.cancelled);
  const cancelled = events.filter((e) => e.cancelled);
  const incomingIds = [...new Set(events.map((e) => e.externalId))];

  const existing = new Map<string, ScheduleRow>();
  if (incomingIds.length > 0) {
    const rows = await db.select().from(scheduleItems).where(and(
      eq(scheduleItems.userId, userId),
      eq(scheduleItems.source, source),
      inArray(scheduleItems.externalId, incomingIds),
    ));
    for (const row of rows) if (row.externalId) existing.set(row.externalId, row);
  }

  for (const event of live) {
    const prior = existing.get(event.externalId);
    const next = toRow(event, { userId, source, calendarSourceId, courses: myCourses, prior });

    if (!prior) {
      await db.insert(scheduleItems).values(next).onConflictDoUpdate({
        target: [scheduleItems.userId, scheduleItems.source, scheduleItems.externalId],
        set: { ...updatable(next), updatedAt: new Date() },
      });
      result.created++;
      continue;
    }

    if (unchangedSince(prior, event) || isSameRow(prior, next)) {
      result.skipped++;
      continue;
    }

    await db.update(scheduleItems)
      .set({ ...updatable(next), updatedAt: new Date() })
      .where(eq(scheduleItems.id, prior.id));
    result.updated++;
  }

  // STATUS:CANCELLED means the student's calendar no longer holds this event.
  for (const event of cancelled) {
    const prior = existing.get(event.externalId);
    if (!prior) continue;
    await db.delete(scheduleItems).where(eq(scheduleItems.id, prior.id));
    result.deleted++;
  }

  if (removeMissing) {
    const keep = live.map((e) => e.externalId);
    // Scoped to this source's own rows: a UID claimed by a second feed has
    // already been taken over by that feed's sync, and is not ours to drop.
    const conditions = [
      eq(scheduleItems.userId, userId),
      eq(scheduleItems.calendarSourceId, calendarSourceId),
    ];
    if (keep.length > 0) conditions.push(notInArray(scheduleItems.externalId, keep));
    const dropped = await db.delete(scheduleItems).where(and(...conditions)).returning({ id: scheduleItems.id });
    result.deleted += dropped.length;
  }

  return result;
}

/** Fetch, parse and reconcile an ICS feed. */
export async function syncIcsFeed(input: {
  userId: string;
  calendarSourceId: string;
  url: string;
  fetchImpl?: typeof fetch;
}): Promise<SyncResult> {
  const text = await fetchIcs(input.url, input.fetchImpl ?? fetch);
  const events = parseIcs(text).map(mapIcsEvent);
  return syncFeedEvents({
    userId: input.userId,
    source: "ics",
    calendarSourceId: input.calendarSourceId,
    events,
    removeMissing: true,
  });
}

export class IcsFetchError extends Error {
  constructor(message: string, readonly permanent: boolean) {
    super(message);
    this.name = "IcsFetchError";
  }
}

const FETCH_TIMEOUT_MS = 20_000;

/**
 * `permanent` splits "this URL is wrong" from "the server is having a moment",
 * so the job worker knows whether a retry could ever succeed.
 */
async function fetchIcs(url: string, fetchImpl: typeof fetch): Promise<string> {
  const target = normalizeFeedUrl(url);
  if (!target) throw new IcsFetchError(`not an http(s) calendar URL: ${url}`, true);

  const res = await fetchImpl(target, {
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept: "text/calendar, text/plain;q=0.9, */*;q=0.8" },
  });
  if (!res.ok) {
    const permanent = res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404 || res.status === 410;
    throw new IcsFetchError(`feed returned ${res.status} ${res.statusText}`, permanent);
  }

  const text = await res.text();
  if (!/BEGIN:VCALENDAR/i.test(text)) {
    throw new IcsFetchError("response is not an iCalendar feed (no BEGIN:VCALENDAR)", true);
  }
  return text;
}

/** `webcal://` is the subscribe scheme Blackboard hands out; it is https underneath. */
export function normalizeFeedUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol === "webcal:") parsed.protocol = "https:";
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed.toString();
}

// ── Row building and comparison ──────────────────────────────────────────────

type RowInsert = typeof scheduleItems.$inferInsert;

function toRow(event: FeedEvent, ctx: {
  userId: string;
  source: FeedSource;
  calendarSourceId: string;
  courses: readonly CourseRef[];
  prior: ScheduleRow | undefined;
}): RowInsert {
  const matched = matchCourseId(event.title, event.description, ctx.courses);
  return {
    userId: ctx.userId,
    source: ctx.source,
    externalId: event.externalId,
    calendarSourceId: ctx.calendarSourceId,
    // Falling back to the stored value rather than null: the student may have
    // filed this event under a course by hand, and a feed that never named a
    // course number has no opinion to override that with.
    courseId: matched ?? ctx.prior?.courseId ?? null,
    kind: inferKind(event.title, event.description, {
      hasSpan: event.startAt !== null && event.endAt !== null,
      hasRrule: event.rrule !== null,
    }),
    title: event.title,
    description: event.description,
    location: event.location,
    startAt: event.startAt,
    endAt: event.endAt,
    dueAt: event.dueAt,
    allDay: event.allDay ? 1 : 0,
    rrule: event.rrule,
    externalUpdatedAt: event.externalUpdatedAt,
  };
}

/**
 * The columns a sync owns. `completedAt` is conspicuously absent and must stay
 * that way — see rule 2 at the top of this file.
 */
function updatable(row: RowInsert) {
  return {
    calendarSourceId: row.calendarSourceId,
    courseId: row.courseId,
    kind: row.kind,
    title: row.title,
    description: row.description,
    location: row.location,
    startAt: row.startAt,
    endAt: row.endAt,
    dueAt: row.dueAt,
    allDay: row.allDay,
    rrule: row.rrule,
    externalUpdatedAt: row.externalUpdatedAt,
  };
}

/** The cheap skip: the feed itself says this event has not been touched. */
function unchangedSince(prior: ScheduleRow, event: FeedEvent): boolean {
  if (!event.externalUpdatedAt || !prior.externalUpdatedAt) return false;
  return event.externalUpdatedAt.getTime() <= prior.externalUpdatedAt.getTime();
}

/**
 * The honest skip, for the many feeds that omit LAST-MODIFIED entirely. Without
 * it, every sync would rewrite every row and `updated_at` would stop meaning
 * anything.
 */
function isSameRow(prior: ScheduleRow, next: RowInsert): boolean {
  const patch = updatable(next);
  for (const [key, value] of Object.entries(patch)) {
    const current = (prior as Record<string, unknown>)[key];
    if (value instanceof Date || current instanceof Date) {
      const a = value instanceof Date ? value.getTime() : null;
      const b = current instanceof Date ? current.getTime() : null;
      if (a !== b) return false;
    } else if ((current ?? null) !== (value ?? null)) {
      return false;
    }
  }
  return true;
}
