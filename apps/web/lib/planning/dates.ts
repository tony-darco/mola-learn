/**
 * Calendar-day arithmetic for the planning loop.
 *
 * Everything here works in the server's LOCAL zone, never UTC. A plan is a
 * calendar day (`dayPlanPayloadSchema.date` says so in as many words), so
 * reaching for `toISOString().slice(0, 10)` would move an 8pm study block to
 * the following day for anyone west of Greenwich — the one bug in this file
 * that would be invisible until a student wondered why Tuesday was empty.
 */

const DAY_MS = 86_400_000;

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export type DateKey = string;

export function dateKey(d: Date): DateKey {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isDateKey(s: unknown): s is DateKey {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** Local midnight on that calendar day. */
export function parseDateKey(key: DateKey): Date {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

export function startOfDay(d: Date): Date {
  const c = new Date(d.getTime());
  c.setHours(0, 0, 0, 0);
  return c;
}

export function endOfDay(d: Date): Date {
  const c = new Date(d.getTime());
  c.setHours(23, 59, 59, 999);
  return c;
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

/** Monday of the week containing `d`. Sunday belongs to the week that just ended. */
export function mondayOf(d: Date): Date {
  const c = startOfDay(d);
  const shift = c.getDay() === 0 ? -6 : 1 - c.getDay();
  return new Date(c.getTime() + shift * DAY_MS);
}

/** The seven date keys Monday..Sunday, which every week payload must carry. */
export function weekDayKeys(monday: Date): DateKey[] {
  return Array.from({ length: 7 }, (_, i) => dateKey(addDays(monday, i)));
}

export function weekdayName(key: DateKey): string {
  return WEEKDAY[parseDateKey(key).getDay()]!;
}

/**
 * The local UTC offset as `+HH:MM`, for the moment given. Handed to the model
 * so the `startAt` values it writes carry the offset zod demands rather than a
 * naive timestamp that would be read back as UTC.
 */
export function offsetSuffix(at: Date): string {
  const minutes = -at.getTimezoneOffset();
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/** `Thu 14:00–15:15`, or `Thu 23:59` for a point deadline. */
export function timeRangeLabel(start: Date, end: Date | null): string {
  const hhmm = (d: Date) =>
    `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return end ? `${hhmm(start)}–${hhmm(end)}` : hhmm(start);
}
