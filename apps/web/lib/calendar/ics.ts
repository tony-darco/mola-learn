/**
 * RFC-5545 parsing, hand-rolled.
 *
 * Written rather than pulled in because the useful subset is small — a
 * Blackboard or Google feed export is VEVENTs with a dozen properties between
 * them — while every ICS library on npm carries a full recurrence expander and
 * a bundled tz database we would not use. The parts that actually break in
 * practice are line folding, escaped text and all-day dates, and those are
 * exactly the parts a dependency would not save us from testing anyway.
 *
 * THE ALL-DAY RULE, because it is the bug this file exists to not have:
 * `DTSTART;VALUE=DATE:20260910` names a calendar day, not an instant. Parsing
 * it as UTC midnight (which is what `new Date("2026-09-10")` does) puts it at
 * 20:00 on the 9th for a student in Baltimore, and the event renders on the
 * wrong day. Every date-only value here is materialised at LOCAL midnight so
 * the local Y/M/D always reads back as the day the feed wrote.
 */

// ── Content lines ────────────────────────────────────────────────────────────

export type ContentLine = {
  name: string;
  /** Parameter names upper-cased; values with surrounding quotes stripped. */
  params: Record<string, string>;
  /** Still escaped — callers decide whether the value is TEXT. */
  value: string;
};

/**
 * RFC 5545 §3.1: a long line is folded by inserting CRLF plus one whitespace,
 * and the continuation is rejoined by dropping exactly that whitespace. Feeds
 * in the wild fold with bare LF too, so all three line endings are accepted.
 */
export function unfoldLines(text: string): string[] {
  const raw = text.replace(/^﻿/, "").split(/\r\n|\n|\r/);
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out.filter((l) => l.length > 0);
}

/** `DTSTART;TZID="America/New_York";VALUE=DATE-TIME:20260910T133000` */
export function parseContentLine(line: string): ContentLine | null {
  // The value separator is the first colon NOT inside a quoted parameter
  // value — a TZID may legally contain one.
  let colon = -1;
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === ":" && !quoted) { colon = i; break; }
  }
  if (colon === -1) return null;

  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);

  const segments: string[] = [];
  let current = "";
  quoted = false;
  for (const ch of head) {
    if (ch === '"') { quoted = !quoted; current += ch; }
    else if (ch === ";" && !quoted) { segments.push(current); current = ""; }
    else current += ch;
  }
  segments.push(current);

  const name = (segments.shift() ?? "").toUpperCase().trim();
  if (!name) return null;

  const params: Record<string, string> = {};
  for (const segment of segments) {
    const eq = segment.indexOf("=");
    if (eq === -1) continue;
    const key = segment.slice(0, eq).toUpperCase().trim();
    params[key] = segment.slice(eq + 1).replace(/^"|"$/g, "");
  }

  return { name, params, value };
}

/** RFC 5545 §3.3.11 TEXT escaping. `\N` is a legal spelling of `\n`. */
export function unescapeText(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== "\\") { out += value[i]; continue; }
    const next = value[++i];
    if (next === undefined) { out += "\\"; break; }
    if (next === "n" || next === "N") out += "\n";
    else out += next; // covers \, \; \\ and any other escaped literal
  }
  return out;
}

// ── Time zones ───────────────────────────────────────────────────────────────

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat | null {
  const cached = FORMATTERS.get(timeZone);
  if (cached) return cached;
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    FORMATTERS.set(timeZone, dtf);
    return dtf;
  } catch {
    // An unknown TZID — Outlook emits Windows names like "Eastern Standard
    // Time", which ICU rejects. Falling back to local time keeps the event.
    return null;
  }
}

/** How far `timeZone` runs ahead of UTC at the given instant, in ms. */
function zoneOffsetMs(utcMs: number, dtf: Intl.DateTimeFormat): number {
  const parts = dtf.formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // Some ICU builds render midnight as hour 24 under hour12: false.
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUtc - utcMs;
}

/**
 * A wall-clock reading in a named zone → the instant it denotes.
 *
 * Two passes: the offset that applies at the *result* is what matters, and it
 * can differ from the offset at the naive guess across a DST boundary.
 */
function wallClockToUtc(
  y: number, mo: number, d: number, h: number, mi: number, s: number, timeZone: string,
): Date {
  const dtf = formatterFor(timeZone);
  if (!dtf) return new Date(y, mo - 1, d, h, mi, s);
  const naive = Date.UTC(y, mo - 1, d, h, mi, s);
  const firstPass = zoneOffsetMs(naive, dtf);
  const corrected = zoneOffsetMs(naive - firstPass, dtf);
  return new Date(naive - corrected);
}

// ── Date values ──────────────────────────────────────────────────────────────

export type IcsDate = { date: Date; allDay: boolean };

const DATE_ONLY = /^(\d{4})(\d{2})(\d{2})$/;
const DATE_TIME = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/;

/**
 * DTSTART / DTEND / LAST-MODIFIED etc. Returns null on anything unparseable
 * rather than an Invalid Date, so a malformed line drops one property instead
 * of poisoning a row with NaN.
 */
export function parseIcsDate(value: string, params: Record<string, string> = {}): IcsDate | null {
  const raw = value.trim();

  const dateOnly = DATE_ONLY.exec(raw);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    // Local midnight — see the all-day rule at the top of this file.
    return { date: new Date(Number(y), Number(m) - 1, Number(d)), allDay: true };
  }

  const dateTime = DATE_TIME.exec(raw);
  if (!dateTime) return null;
  const [, y, mo, d, h, mi, s, utc] = dateTime;
  const n = (v: string) => Number(v);

  if (utc) {
    return { date: new Date(Date.UTC(n(y), n(mo) - 1, n(d), n(h), n(mi), n(s))), allDay: false };
  }
  if (params.TZID) {
    return { date: wallClockToUtc(n(y), n(mo), n(d), n(h), n(mi), n(s), params.TZID), allDay: false };
  }
  // Floating time: RFC 5545 §3.3.5 says it means local wherever it is read.
  return { date: new Date(n(y), n(mo) - 1, n(d), n(h), n(mi), n(s)), allDay: false };
}

const DURATION = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

/** DURATION, for feeds that carry it instead of DTEND (Apple Calendar does). */
export function parseIcsDuration(value: string): number | null {
  const m = DURATION.exec(value.trim());
  if (!m) return null;
  const [, sign, w, d, h, mi, s] = m;
  const ms = (Number(w ?? 0) * 7 + Number(d ?? 0)) * 86_400_000
    + Number(h ?? 0) * 3_600_000 + Number(mi ?? 0) * 60_000 + Number(s ?? 0) * 1000;
  return sign === "-" ? -ms : ms;
}

// ── VEVENT ───────────────────────────────────────────────────────────────────

export type IcsEvent = {
  uid: string;
  /** Set on a single overridden instance of a recurring series. */
  recurrenceId: string | null;
  summary: string;
  description: string | null;
  location: string | null;
  start: Date | null;
  /** Already normalised: for an all-day event this is the last instant of the
   * last included day, not RFC's exclusive next-midnight. See `endOf`. */
  end: Date | null;
  allDay: boolean;
  rrule: string | null;
  status: string | null;
  lastModified: Date | null;
};

const END_OF_DAY_MS = 86_400_000 - 1;

type Draft = {
  props: Map<string, ContentLine>;
  duration: number | null;
};

/**
 * Every VEVENT in the feed.
 *
 * Nested components are tracked with a stack so VTIMEZONE's own DTSTART lines
 * and a VALARM's TRIGGER never leak into the event being built — the single
 * most common way a naive line-by-line parser corrupts an event's start time.
 */
export function parseIcs(text: string): IcsEvent[] {
  const events: IcsEvent[] = [];
  const stack: string[] = [];
  let draft: Draft | null = null;

  for (const line of unfoldLines(text)) {
    const parsed = parseContentLine(line);
    if (!parsed) continue;

    if (parsed.name === "BEGIN") {
      const component = parsed.value.toUpperCase().trim();
      stack.push(component);
      if (component === "VEVENT") draft = { props: new Map(), duration: null };
      continue;
    }
    if (parsed.name === "END") {
      const component = stack.pop();
      if (component === "VEVENT" && draft) {
        const event = buildEvent(draft);
        if (event) events.push(event);
        draft = null;
      }
      continue;
    }

    // Only properties directly inside the VEVENT, never a VALARM's.
    if (!draft || stack[stack.length - 1] !== "VEVENT") continue;
    if (parsed.name === "DURATION") draft.duration = parseIcsDuration(parsed.value);
    // First writer wins: a duplicated property is malformed, and the first is
    // the one a reader would have seen.
    else if (!draft.props.has(parsed.name)) draft.props.set(parsed.name, parsed);
  }

  return events;
}

function buildEvent(draft: Draft): IcsEvent | null {
  const { props } = draft;
  const text = (name: string): string | null => {
    const line = props.get(name);
    return line ? unescapeText(line.value) : null;
  };
  const date = (name: string): IcsDate | null => {
    const line = props.get(name);
    return line ? parseIcsDate(line.value, line.params) : null;
  };

  const uid = props.get("UID")?.value.trim();
  const dtstart = date("DTSTART");
  // An event with no UID cannot be deduped across syncs, and one with no start
  // cannot be placed on a calendar. Either way there is nothing to store.
  if (!uid || !dtstart) return null;

  const allDay = dtstart.allDay || props.get("DTSTART")?.params.VALUE === "DATE";
  const dtend = date("DTEND");

  let end: Date | null = null;
  if (dtend) {
    end = allDay ? endOf(dtend.date) : dtend.date;
  } else if (draft.duration !== null) {
    const computed = new Date(dtstart.date.getTime() + draft.duration);
    end = allDay ? endOf(computed) : computed;
  } else if (allDay) {
    // RFC 5545 §3.6.1: a date-only DTSTART with no DTEND lasts one day.
    end = new Date(dtstart.date.getTime() + END_OF_DAY_MS);
  }

  return {
    uid,
    recurrenceId: props.get("RECURRENCE-ID")?.value.trim() ?? null,
    summary: text("SUMMARY")?.trim() || "(untitled)",
    description: text("DESCRIPTION"),
    location: text("LOCATION"),
    start: dtstart.date,
    end,
    allDay,
    rrule: props.get("RRULE")?.value.trim() ?? null,
    status: props.get("STATUS")?.value.trim().toUpperCase() ?? null,
    lastModified: (date("LAST-MODIFIED") ?? date("DTSTAMP"))?.date ?? null,
  };
}

/**
 * DTEND on an all-day event is EXCLUSIVE — a one-day event on the 10th ends
 * `20260911`. Storing that verbatim makes every all-day event render a day
 * longer than it is, so it is pulled back to the last instant of the last
 * included day. The date parts on both ends then read as the days the feed
 * meant, which is the whole point.
 */
function endOf(exclusiveEnd: Date): Date {
  return new Date(exclusiveEnd.getTime() - 1);
}
