/**
 * Grid arithmetic for the calendar surface. Pure functions, no React, no DB —
 * this is the part that is actually worth testing, and the part that quietly
 * breaks a calendar when it is wrong.
 *
 * Two decisions run through all of it:
 *
 * 1. **Days are built from local date components, never from millisecond
 *    arithmetic.** `t + 86_400_000` lands on 23:00 the same day across a DST
 *    spring-forward, which shifts a whole week column by an hour and puts an
 *    event in the wrong cell. `new Date(y, m, d + n)` does not.
 *
 * 2. **An all-day event's date is read in UTC; a timed event's in local.**
 *    An all-day item has no time of day — it is a date — and is stored at UTC
 *    midnight of that date. Reading it with local getters puts "Sept 7" on
 *    Sept 6 for every viewer west of Greenwich. Timed events are the opposite:
 *    a 10:00 lecture belongs in the viewer's 10:00 row.
 *
 * The week starts on **Monday**, matching `weekPlanPayloadSchema.weekStart` in
 * the frozen planning contract — one week boundary across the whole workstream.
 */
import type { CalendarEvent, CalendarView } from "@mola/shared";

export const MINUTES_PER_DAY = 1440;

/** Local midnight of `d`. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** `n` days later at local midnight — DST-safe (see the note above). */
export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** Clamps the day-of-month so `addMonths(Jan 31, 1)` is Feb 28, not Mar 3. */
export function addMonths(d: Date, n: number): Date {
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), lastDay));
}

/** Monday on or before `d`, at local midnight. */
export function startOfWeek(d: Date): Date {
  // getDay(): 0=Sun … 6=Sat. Sunday closes the week it ends, so it goes back six.
  const shift = d.getDay() === 0 ? -6 : 1 - d.getDay();
  return addDays(startOfDay(d), shift);
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** Stable local-calendar key, `YYYY-MM-DD`. */
export function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** The same key read off a `Date`'s UTC components — for all-day events. */
export function utcDayKey(d: Date): string {
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${m}-${day}`;
}

export function isSameDay(a: Date, b: Date): boolean {
  return dayKey(a) === dayKey(b);
}

/**
 * Always 42 cells — six rows of seven, starting on the Monday on or before the
 * first of `anchor`'s month. A fixed height matters more than a tight one: a
 * grid that is five rows in one month and six in the next jumps under the
 * cursor every time you page through the semester.
 */
export function monthGridDays(anchor: Date): Date[] {
  const first = startOfWeek(startOfMonth(anchor));
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

export function weekDays(anchor: Date): Date[] {
  const monday = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** The `[from, to)` instant window a view needs fetched, padded to whole days. */
export function rangeFor(view: CalendarView, anchor: Date): { from: Date; to: Date } {
  if (view === "day") {
    const from = startOfDay(anchor);
    return { from, to: addDays(from, 1) };
  }
  if (view === "week") {
    const from = startOfWeek(anchor);
    return { from, to: addDays(from, 7) };
  }
  const days = monthGridDays(anchor);
  return { from: days[0]!, to: addDays(days[41]!, 1) };
}

/** One step of `view` from `anchor`, forward or back. */
export function step(view: CalendarView, anchor: Date, direction: 1 | -1): Date {
  if (view === "month") return addMonths(anchor, direction);
  return addDays(anchor, direction * (view === "week" ? 7 : 1));
}

// ── Placing an event on the grid ─────────────────────────────────────────────

/**
 * Every local day key the event occupies.
 *
 * All-day events use UTC components, and their end is treated as **exclusive**
 * by subtracting a millisecond before reading the date — that is what ICS
 * `DTEND;VALUE=DATE` means, so a one-day event whose end is the following
 * midnight renders on one day rather than smeared across two.
 */
export function eventDayKeys(ev: CalendarEvent): string[] {
  const start = new Date(ev.start);
  const end = ev.end ? new Date(ev.end) : null;

  if (ev.allDay) {
    const last = end && end.getTime() > start.getTime() ? new Date(end.getTime() - 1) : start;
    const keys: string[] = [];
    const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    const lastKey = utcDayKey(last);
    // Guard against a malformed feed handing us a decade-long "all-day" span.
    for (let i = 0; i < 366; i++) {
      keys.push(utcDayKey(cursor));
      if (utcDayKey(cursor) === lastKey) break;
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return keys;
  }

  const keys = [dayKey(start)];
  if (!end || end.getTime() <= start.getTime()) return keys;
  // An event ending exactly at midnight belongs to the day it ran in, not to
  // the empty first instant of the next one.
  const last = startOfDay(new Date(end.getTime() - 1));
  for (let cursor = addDays(startOfDay(start), 1); cursor <= last; cursor = addDays(cursor, 1)) {
    keys.push(dayKey(cursor));
    if (keys.length > 366) break;
  }
  return keys;
}

/** Groups events by the local day key they render on. */
export function groupByDay(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const byDay = new Map<string, CalendarEvent[]>();
  for (const ev of events) {
    for (const key of eventDayKeys(ev)) {
      const bucket = byDay.get(key);
      if (bucket) bucket.push(ev);
      else byDay.set(key, [ev]);
    }
  }
  return byDay;
}

/**
 * An all-day item, or a pure deadline with no span — both belong in the pinned
 * row above the week/day time grid rather than at a clock position. A midnight
 * deadline pinned to the bottom of a 24-hour column is the single most common
 * way a student misses it.
 */
export function isPinnedRowEvent(ev: CalendarEvent): boolean {
  return ev.allDay || ev.end === null;
}

/** Minutes from local midnight of `day`, clamped into that day. */
export function minutesInto(day: Date, instant: Date): number {
  const offset = (instant.getTime() - startOfDay(day).getTime()) / 60_000;
  return Math.max(0, Math.min(MINUTES_PER_DAY, Math.round(offset)));
}

export type TimedSlot = {
  event: CalendarEvent;
  /** Minutes from local midnight. */
  startMin: number;
  endMin: number;
  /** 0-based column within its overlap cluster, and how many that cluster needs. */
  column: number;
  columns: number;
};

/** Below this, a 30-minute quiz and a 50-minute lecture stack unreadably. */
const MIN_LAYOUT_MINUTES = 25;

/**
 * Side-by-side placement for overlapping events on one day.
 *
 * Events are clustered by transitive overlap, and inside a cluster each event
 * takes the first column whose previous occupant has already ended. Every event
 * in a cluster then shares that cluster's column count, so a 10:00–11:00 and a
 * 10:30–11:30 split the width evenly instead of covering each other.
 */
export function layoutDay(day: Date, events: CalendarEvent[]): TimedSlot[] {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);

  const slots = events
    .filter((e) => !isPinnedRowEvent(e))
    .map((event) => {
      const start = new Date(event.start);
      const end = event.end ? new Date(event.end) : start;
      return {
        event,
        startMin: minutesInto(day, start < dayStart ? dayStart : start),
        endMin: minutesInto(day, end > dayEnd ? dayEnd : end),
      };
    })
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  const placed: TimedSlot[] = [];
  let cluster: TimedSlot[] = [];
  let clusterEnd = -1;
  /** Per-column, the layout-end of whatever currently sits in it. */
  let columnEnds: number[] = [];

  const flush = () => {
    for (const s of cluster) s.columns = columnEnds.length;
    placed.push(...cluster);
    cluster = [];
    columnEnds = [];
    clusterEnd = -1;
  };

  for (const s of slots) {
    const layoutEnd = Math.max(s.endMin, s.startMin + MIN_LAYOUT_MINUTES);
    if (cluster.length > 0 && s.startMin >= clusterEnd) flush();

    let column = columnEnds.findIndex((end) => end <= s.startMin);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(layoutEnd);
    } else {
      columnEnds[column] = layoutEnd;
    }

    cluster.push({ ...s, column, columns: 1 });
    clusterEnd = Math.max(clusterEnd, layoutEnd);
  }
  if (cluster.length > 0) flush();

  return placed;
}
