/**
 * Agent J1 — ICS ingestion (§10 Tier 1).
 *
 * The fixture is a composed Blackboard-style export rather than a string per
 * assertion, because most of what breaks an ICS parser is context: a VTIMEZONE
 * with its own DTSTART, a VALARM with its own DESCRIPTION, a folded line in the
 * middle of a word. Each test picks the VEVENTs it needs out of the same
 * realistic calendar.
 *
 * Requires the local stack (`pnpm db:migrate && pnpm db:seed`). No network and
 * no live Google: the feed is handed to `syncIcsFeed` through its injectable
 * `fetch`, which is the whole reason that parameter exists.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { calendarSources, courses, db, scheduleItems, users } from "@mola/db";
import { parseIcs, parseIcsDate, unescapeText, unfoldLines } from "../lib/calendar/ics";
import { mapIcsEvent, matchCourseId } from "../lib/calendar/mapping";
import { syncIcsFeed } from "../lib/calendar/sync";

/**
 * Pinned east-coast, deliberately. The all-day bug this parser exists to avoid
 * only reproduces in a zone behind UTC — under TZ=UTC a naive `new Date("…")`
 * lands on the right day by accident and the test proves nothing.
 */
process.env.TZ = "America/New_York";

// ── Fixture ──────────────────────────────────────────────────────────────────

const CALENDAR_HEAD = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Blackboard Inc.//Blackboard Learn//EN",
  "CALSCALE:GREGORIAN",
  "METHOD:PUBLISH",
  // A VTIMEZONE carries DTSTART lines of its own. A parser that does not track
  // nesting reads them as the next event's start time.
  "BEGIN:VTIMEZONE",
  "TZID:America/New_York",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:-0500",
  "TZOFFSETTO:-0400",
  "TZNAME:EDT",
  "DTSTART:19700308T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:-0400",
  "TZOFFSETTO:-0500",
  "TZNAME:EST",
  "DTSTART:19701101T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
];

const LECTURE = [
  "BEGIN:VEVENT",
  "UID:mola-ics-test-lecture@blackboard.umbc.edu",
  "DTSTAMP:20260901T120000Z",
  "DTSTART;TZID=America/New_York:20260909T100000",
  "DTEND;TZID=America/New_York:20260909T111500",
  "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261211T235900Z",
  "SUMMARY:ENEE 645 Lecture",
  "LOCATION:ITE 231",
  // The VALARM's own DESCRIPTION must not become the event's.
  "BEGIN:VALARM",
  "TRIGGER:-PT15M",
  "ACTION:DISPLAY",
  "DESCRIPTION:Reminder",
  "END:VALARM",
  "END:VEVENT",
];

const HOMEWORK = [
  "BEGIN:VEVENT",
  "UID:mola-ics-test-hw3@blackboard.umbc.edu",
  "DTSTAMP:20260901T120000Z",
  "DTSTART;VALUE=DATE:20260910",
  "DTEND;VALUE=DATE:20260911",
  "SUMMARY:ENEE 645 Homework 3 due",
  "DESCRIPTION:Submit through Blackboard\\, before midnight\\; late work loses 10%.\\nSee the syllabus.",
  "END:VEVENT",
];

/** Same event, retitled, with a newer DTSTAMP — what an edited feed looks like. */
const HOMEWORK_EDITED = [
  "BEGIN:VEVENT",
  "UID:mola-ics-test-hw3@blackboard.umbc.edu",
  "DTSTAMP:20260903T090000Z",
  "DTSTART;VALUE=DATE:20260910",
  "DTEND;VALUE=DATE:20260911",
  "SUMMARY:ENEE 645 Homework 3 due (extended)",
  "DESCRIPTION:Submit through Blackboard\\, before midnight\\; late work loses 10%.\\nSee the syllabus.",
  "END:VEVENT",
];

// Folded mid-word: unfolding has to drop exactly one leading space, no more.
const REVIEW = [
  "BEGIN:VEVENT",
  "UID:mola-ics-test-review@blackboard.umbc.edu",
  "DTSTAMP:20260901T120000Z",
  "DTSTART;TZID=America/New_York:20260915T160000",
  "DTEND;TZID=America/New_York:20260915T173000",
  "SUMMARY:ENEE 645 / PHYS 122 joint review session before the mid",
  " term",
  "LOCATION:Library 767",
  "END:VEVENT",
];

const QUIZ = [
  "BEGIN:VEVENT",
  "UID:mola-ics-test-quiz@blackboard.umbc.edu",
  "DTSTAMP:20260901T120000Z",
  "DTSTART:20260917T140000Z",
  "DTEND:20260917T145000Z",
  "SUMMARY:PHYS 122 Quiz 4",
  "STATUS:CONFIRMED",
  "END:VEVENT",
];

const QUIZ_CANCELLED = QUIZ.map((line) => (line === "STATUS:CONFIRMED" ? "STATUS:CANCELLED" : line));

const STUDY_GROUP = [
  "BEGIN:VEVENT",
  "UID:mola-ics-test-studygroup@blackboard.umbc.edu",
  "DTSTAMP:20260901T120000Z",
  "LAST-MODIFIED:20260902T083000Z",
  "DTSTART;TZID=America/New_York:20260912T180000",
  "DTEND;TZID=America/New_York:20260912T200000",
  "SUMMARY:Study group",
  "LOCATION:Commons 331",
  "END:VEVENT",
];

const MIDTERM = [
  "BEGIN:VEVENT",
  "UID:mola-ics-test-midterm@blackboard.umbc.edu",
  "DTSTAMP:20260901T120000Z",
  "DTSTART;TZID=America/New_York:20260924T130000",
  "DTEND;TZID=America/New_York:20260924T143000",
  "SUMMARY:PHYS 122 Midterm 1",
  "LOCATION:PHYS 101",
  "END:VEVENT",
];

/** CRLF, as RFC 5545 requires and as every real feed emits. */
function feed(...events: string[][]): string {
  return [...CALENDAR_HEAD, ...events.flat(), "END:VCALENDAR"].join("\r\n");
}

const FULL_FEED = feed(LECTURE, HOMEWORK, REVIEW, QUIZ_CANCELLED, STUDY_GROUP, MIDTERM);
/** Five live events; the quiz is cancelled and is not one of them. */
const LIVE_EVENT_COUNT = 5;

function serving(ics: string): typeof fetch {
  return async () => new Response(ics, { headers: { "content-type": "text/calendar" } });
}

function eventByUid(ics: string, uid: string) {
  const event = parseIcs(ics).find((e) => e.uid === uid);
  if (!event) throw new Error(`fixture has no VEVENT with UID ${uid}`);
  return event;
}

// ── Parsing ──────────────────────────────────────────────────────────────────

describe("ics — line unfolding (RFC 5545 §3.1)", () => {
  it("rejoins a continuation line, dropping exactly the one folding space", () => {
    const event = eventByUid(FULL_FEED, "mola-ics-test-review@blackboard.umbc.edu");
    expect(event.summary).toBe("ENEE 645 / PHYS 122 joint review session before the midterm");
  });

  it("accepts LF and tab folding as well as CRLF and space", () => {
    // The folding whitespace itself is removed, not kept: a space that has to
    // survive the fold is written twice, which is what the review event does.
    expect(unfoldLines("SUMMARY:one\n two\r\nDESCRIPTION:three\n\tfour")).toEqual([
      "SUMMARY:onetwo",
      "DESCRIPTION:threefour",
    ]);
    expect(unfoldLines("SUMMARY:one\n  two")).toEqual(["SUMMARY:one two"]);
  });
});

describe("ics — all-day dates", () => {
  it("materialises VALUE=DATE at local midnight, not UTC midnight", () => {
    // The trap, made explicit: this is what the naive parse does in this zone.
    expect(new Date("2026-09-10").getDate()).toBe(9);

    const parsed = parseIcsDate("20260910", { VALUE: "DATE" });
    expect(parsed?.allDay).toBe(true);
    expect(parsed?.date.getFullYear()).toBe(2026);
    expect(parsed?.date.getMonth()).toBe(8);
    expect(parsed?.date.getDate()).toBe(10);
  });

  it("pulls an exclusive DTEND back to the last instant of the last included day", () => {
    const event = eventByUid(FULL_FEED, "mola-ics-test-hw3@blackboard.umbc.edu");
    expect(event.allDay).toBe(true);
    expect(event.start?.getDate()).toBe(10);
    // DTEND is 20260911 — an event that renders through the 11th is a day too long.
    expect(event.end?.getDate()).toBe(10);
  });

  it("resolves a TZID wall-clock reading to the right instant", () => {
    const event = eventByUid(FULL_FEED, "mola-ics-test-lecture@blackboard.umbc.edu");
    // 10:00 EDT on 2026-09-09 is 14:00Z.
    expect(event.start?.toISOString()).toBe("2026-09-09T14:00:00.000Z");
  });
});

describe("ics — TEXT escaping (RFC 5545 §3.3.11)", () => {
  it("unescapes commas, semicolons and newlines in a description", () => {
    const event = eventByUid(FULL_FEED, "mola-ics-test-hw3@blackboard.umbc.edu");
    expect(event.description).toBe(
      "Submit through Blackboard, before midnight; late work loses 10%.\nSee the syllabus.",
    );
  });

  it("treats \\N as a newline and leaves a backslash-escaped backslash alone", () => {
    expect(unescapeText("a\\Nb")).toBe("a\nb");
    expect(unescapeText("C:\\\\Users")).toBe("C:\\Users");
  });
});

describe("ics — component nesting", () => {
  it("keeps a VALARM's own DESCRIPTION out of the event", () => {
    const event = eventByUid(FULL_FEED, "mola-ics-test-lecture@blackboard.umbc.edu");
    expect(event.description).toBeNull();
  });

  it("keeps VTIMEZONE's DTSTART out of the first event", () => {
    const event = eventByUid(FULL_FEED, "mola-ics-test-lecture@blackboard.umbc.edu");
    expect(event.start?.getFullYear()).toBe(2026);
  });

  it("carries RRULE through verbatim rather than dropping a recurring series", () => {
    const event = eventByUid(FULL_FEED, "mola-ics-test-lecture@blackboard.umbc.edu");
    expect(event.rrule).toBe("FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261211T235900Z");
  });
});

describe("ics — STATUS:CANCELLED", () => {
  it("parses to a cancelled feed event rather than being silently dropped", () => {
    const event = eventByUid(FULL_FEED, "mola-ics-test-quiz@blackboard.umbc.edu");
    expect(event.status).toBe("CANCELLED");
    expect(mapIcsEvent(event).cancelled).toBe(true);
  });

  it("leaves a confirmed event uncancelled", () => {
    const event = eventByUid(feed(QUIZ), "mola-ics-test-quiz@blackboard.umbc.edu");
    expect(mapIcsEvent(event).cancelled).toBe(false);
  });
});

// ── Course matching ──────────────────────────────────────────────────────────

describe("mapping — course matching", () => {
  const enrolled = [
    { id: "course-enee", number: "ENEE 645" },
    { id: "course-phys", number: "PHYS 122" },
  ];

  it("matches a course number in the title, however it is spaced", () => {
    expect(matchCourseId("ENEE 645 Lecture", null, enrolled)).toBe("course-enee");
    expect(matchCourseId("ENEE645 Lecture", null, enrolled)).toBe("course-enee");
    expect(matchCourseId("ENEE-645 Lecture", null, enrolled)).toBe("course-enee");
  });

  it("matches a course number that only appears in the description", () => {
    expect(matchCourseId("Homework 3 due", "Posted for PHYS 122.", enrolled)).toBe("course-phys");
  });

  it("returns null when the event names no course at all", () => {
    expect(matchCourseId("Study group", "Commons 331", enrolled)).toBeNull();
  });

  it("returns null for a course number the student is not enrolled in", () => {
    expect(matchCourseId("BIOL 100 Lecture", null, enrolled)).toBeNull();
  });

  it("returns null on ambiguity rather than guessing the first course", () => {
    // Filing this under ENEE would put a PHYS review into the wrong workload,
    // and the student would have no way to see why.
    expect(matchCourseId("ENEE 645 / PHYS 122 joint review", null, enrolled)).toBeNull();
  });
});

// ── Sync ─────────────────────────────────────────────────────────────────────

describe("sync — reconciling a feed against schedule_items", () => {
  let userId: string;
  let sourceId: string;
  let enee: string;
  let phys: string;

  beforeAll(async () => {
    const [alice] = await db.select().from(users).where(eq(users.email, "alice@umbc.edu"));
    if (!alice) throw new Error("run `pnpm db:seed` first");
    userId = alice.id;

    // Course numbers the seed does not use (it has CMSC 421 and MATH 221), so
    // matching here is decided by this fixture and not by seed drift.
    const created = await db.insert(courses).values([
      { userId, name: "Digital Logic Design", number: "ENEE 645" },
      { userId, name: "Introductory Physics II", number: "PHYS 122" },
    ]).returning();
    enee = created[0]!.id;
    phys = created[1]!.id;

    const [source] = await db.insert(calendarSources).values({
      userId, kind: "ics", name: "ICS test feed", url: "https://example.invalid/feed.ics",
    }).returning();
    sourceId = source!.id;
  });

  afterAll(async () => {
    // The source cascades to its schedule_items; the courses have to go too, or
    // the next run's ambiguity assertions would see four matching rows.
    await db.delete(calendarSources).where(eq(calendarSources.id, sourceId));
    await db.delete(courses).where(eq(courses.id, enee));
    await db.delete(courses).where(eq(courses.id, phys));
  });

  /** Each test syncs from an empty feed of its own — no ordering between them. */
  beforeEach(async () => {
    await db.delete(scheduleItems).where(eq(scheduleItems.calendarSourceId, sourceId));
  });

  const sync = (ics: string) =>
    syncIcsFeed({ userId, calendarSourceId: sourceId, url: "https://example.invalid/feed.ics", fetchImpl: serving(ics) });

  const rows = () =>
    db.select().from(scheduleItems).where(eq(scheduleItems.calendarSourceId, sourceId));

  const rowByUid = async (uid: string) => {
    const [row] = await db.select().from(scheduleItems).where(and(
      eq(scheduleItems.userId, userId),
      eq(scheduleItems.source, "ics"),
      eq(scheduleItems.externalId, uid),
    ));
    return row;
  };

  it("creates a row per live event and skips the cancelled one", async () => {
    const result = await sync(FULL_FEED);
    expect(result).toEqual({ created: LIVE_EVENT_COUNT, updated: 0, skipped: 0, deleted: 0 });
    expect(await rowByUid("mola-ics-test-quiz@blackboard.umbc.edu")).toBeUndefined();
  });

  it("files each event under the course it names, and none under a guess", async () => {
    await sync(FULL_FEED);
    expect((await rowByUid("mola-ics-test-lecture@blackboard.umbc.edu"))?.courseId).toBe(enee);
    expect((await rowByUid("mola-ics-test-midterm@blackboard.umbc.edu"))?.courseId).toBe(phys);
    expect((await rowByUid("mola-ics-test-studygroup@blackboard.umbc.edu"))?.courseId).toBeNull();
    // Names both courses — belongs to neither as far as the planner is concerned.
    expect((await rowByUid("mola-ics-test-review@blackboard.umbc.edu"))?.courseId).toBeNull();
  });

  it("stores an all-day event on the day the feed wrote, in local terms", async () => {
    await sync(FULL_FEED);
    const row = await rowByUid("mola-ics-test-hw3@blackboard.umbc.edu");
    expect(row?.allDay).toBe(1);
    expect(row?.startAt?.getDate()).toBe(10);
    expect(row?.startAt?.getMonth()).toBe(8);
    expect(row?.endAt?.getDate()).toBe(10);
  });

  it("is idempotent: a second run over an unchanged feed writes nothing at all", async () => {
    await sync(FULL_FEED);
    const before = await rows();

    const again = await sync(FULL_FEED);
    expect(again).toEqual({ created: 0, updated: 0, skipped: LIVE_EVENT_COUNT, deleted: 0 });

    // Not just the counters — the rows themselves, `updatedAt` included, which
    // is what makes "did anything change?" answerable from the table.
    const after = await rows();
    const byId = (list: typeof before) => [...list].sort((a, b) => a.id.localeCompare(b.id));
    expect(byId(after)).toEqual(byId(before));
  });

  it("preserves a student's check-off across a re-sync that updates the row", async () => {
    await sync(FULL_FEED);
    const completedAt = new Date("2026-09-09T18:00:00.000Z");
    await db.update(scheduleItems)
      .set({ completedAt })
      .where(eq(scheduleItems.id, (await rowByUid("mola-ics-test-hw3@blackboard.umbc.edu"))!.id));

    // The retitled homework forces the update path — a skip would prove nothing.
    const result = await sync(feed(LECTURE, HOMEWORK_EDITED, REVIEW, QUIZ_CANCELLED, STUDY_GROUP, MIDTERM));
    expect(result.updated).toBe(1);

    const row = await rowByUid("mola-ics-test-hw3@blackboard.umbc.edu");
    expect(row?.title).toBe("ENEE 645 Homework 3 due (extended)");
    // The check-off is student state, not feed state. A sync that cleared it
    // would look like a UI glitch and never get reported.
    expect(row?.completedAt?.toISOString()).toBe(completedAt.toISOString());
  });

  it("removes a row when the feed later marks the event cancelled", async () => {
    await sync(feed(LECTURE, QUIZ));
    expect(await rowByUid("mola-ics-test-quiz@blackboard.umbc.edu")).toBeDefined();

    const result = await sync(feed(LECTURE, QUIZ_CANCELLED));
    expect(result.deleted).toBe(1);
    expect(await rowByUid("mola-ics-test-quiz@blackboard.umbc.edu")).toBeUndefined();
  });

  it("removes a row the complete feed no longer lists", async () => {
    await sync(FULL_FEED);
    const result = await sync(feed(LECTURE, HOMEWORK, REVIEW, MIDTERM));
    expect(result.deleted).toBe(1);
    expect(await rowByUid("mola-ics-test-studygroup@blackboard.umbc.edu")).toBeUndefined();
  });
});
