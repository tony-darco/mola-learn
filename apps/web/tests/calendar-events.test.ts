/**
 * Contract D's events endpoints plus the grid arithmetic behind them.
 *
 * The date math is tested harder than the route is on purpose: the query is
 * one predicate, but a calendar that puts an event in the wrong cell looks
 * completely fine to a passing typecheck and completely wrong to a student.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { courses, db, scheduleItems, users } from "@mola/db";
import type { CalendarEvent } from "@mola/shared";
import { AuthzError, requireOwned } from "../lib/auth/ownership";
import {
  getCalendarEvent, listCalendarEvents, toCalendarEvent, type ScheduleItemRow,
} from "../app/api/calendar/events/query";
import {
  addMonths, dayKey, eventDayKeys, isPinnedRowEvent, layoutDay, monthGridDays,
  rangeFor, startOfWeek, step,
} from "../components/calendar/date-math";

// ── Fixtures ─────────────────────────────────────────────────────────────────

let alice: { id: string }, bob: { id: string }, course: { id: string; name: string };
const created: string[] = [];

/** Local midnight on a fixed calendar date, so the window assertions below do
 * not drift with whatever day the suite happens to run on. */
function at(day: number, hour: number, minute = 0): Date {
  return new Date(2031, 2, day, hour, minute, 0, 0);
}

async function insert(row: Partial<typeof scheduleItems.$inferInsert> & {
  userId: string; kind: CalendarEvent["kind"]; title: string;
}): Promise<string> {
  const [inserted] = await db.insert(scheduleItems)
    .values({ source: "student", ...row })
    .returning();
  created.push(inserted!.id);
  return inserted!.id;
}

let lectureId: string, deadlineId: string, outsideId: string, bobsId: string;

beforeAll(async () => {
  const [a] = await db.select().from(users).where(eq(users.email, "alice@umbc.edu"));
  const [b] = await db.select().from(users).where(eq(users.email, "bob@umbc.edu"));
  if (!a || !b) throw new Error("run `pnpm db:seed` first");
  alice = a;
  bob = b;

  const [c] = await db.select().from(courses).where(eq(courses.userId, alice.id));
  if (!c) throw new Error("run `pnpm db:seed` first");
  course = c;

  // A span inside the window, on March 12 2031.
  lectureId = await insert({
    userId: alice.id, courseId: course.id, kind: "class", title: "events-test lecture",
    startAt: at(12, 10), endAt: at(12, 10, 50), dueAt: at(12, 10), location: "ITE 227",
  });
  // A pure deadline — only dueAt, which the projection must read into `start`.
  deadlineId = await insert({
    userId: alice.id, courseId: course.id, kind: "assignment", title: "events-test deadline",
    dueAt: at(12, 23, 59),
  });
  // Two days past the window's end.
  outsideId = await insert({
    userId: alice.id, kind: "event", title: "events-test outside",
    startAt: at(20, 9), endAt: at(20, 10), dueAt: at(20, 9),
  });
  // Bob's, inside the window — must never appear in Alice's list.
  bobsId = await insert({
    userId: bob.id, kind: "event", title: "events-test bob", startAt: at(12, 9), endAt: at(12, 11),
  });
});

afterAll(async () => {
  if (created.length > 0) await db.delete(scheduleItems).where(inArray(scheduleItems.id, created));
});

const WINDOW = { from: at(9, 0), to: at(16, 0) };

// ── The read model ───────────────────────────────────────────────────────────

describe("listCalendarEvents — date window", () => {
  it("returns events inside the window", async () => {
    const ids = (await listCalendarEvents(alice.id, WINDOW)).map((e) => e.id);
    expect(ids).toContain(lectureId);
    expect(ids).toContain(deadlineId);
  });

  it("excludes events outside it", async () => {
    const ids = (await listCalendarEvents(alice.id, WINDOW)).map((e) => e.id);
    expect(ids).not.toContain(outsideId);
  });

  it("includes an event that overlaps the edge without starting inside it", async () => {
    // Starts before the window opens, ends after — containment would drop it.
    const spanning = await insert({
      userId: alice.id, kind: "event", title: "events-test spanning",
      startAt: at(8, 22), endAt: at(9, 2), dueAt: at(8, 22),
    });
    const ids = (await listCalendarEvents(alice.id, WINDOW)).map((e) => e.id);
    expect(ids).toContain(spanning);
  });

  it("orders by start", async () => {
    const events = await listCalendarEvents(alice.id, WINDOW);
    const times = events.map((e) => new Date(e.start).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("filters by course without leaking uncoursed items", async () => {
    const events = await listCalendarEvents(alice.id, { ...WINDOW, courseId: course.id });
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.courseId === course.id)).toBe(true);
  });
});

describe("listCalendarEvents — §9 user scoping", () => {
  it("never returns another user's events", async () => {
    const ids = (await listCalendarEvents(alice.id, WINDOW)).map((e) => e.id);
    expect(ids).not.toContain(bobsId);
  });

  it("returns nothing for a user who owns nothing", async () => {
    const events = await listCalendarEvents("00000000-0000-0000-0000-000000000000", WINDOW);
    expect(events).toEqual([]);
  });

  it("getCalendarEvent refuses to read across users", async () => {
    expect(await getCalendarEvent(alice.id, lectureId)).not.toBeNull();
    expect(await getCalendarEvent(bob.id, lectureId)).toBeNull();
  });
});

describe("contract 2 — scheduleItem ownership (§9)", () => {
  it("returns the row for its owner", async () => {
    const row = await requireOwned("scheduleItem", lectureId, { userId: alice.id, email: "a" });
    expect(row.id).toBe(lectureId);
  });

  it("denies a different signed-in user with 404 — foreign and missing look alike", async () => {
    const denial = async (id: string, userId: string): Promise<AuthzError> => {
      try {
        await requireOwned("scheduleItem", id, { userId, email: "b" });
      } catch (e) {
        if (e instanceof AuthzError) return e;
      }
      throw new Error("expected an AuthzError");
    };
    const foreign = await denial(lectureId, bob.id);
    const missing = await denial("00000000-0000-0000-0000-000000000000", bob.id);
    expect(foreign.status).toBe(404);
    expect(foreign.status).toBe(missing.status);
  });

  it("denies an unauthenticated caller with 401", async () => {
    await expect(requireOwned("scheduleItem", lectureId, null)).rejects.toMatchObject({ status: 401 });
  });
});

// ── `startAt ?? dueAt` ───────────────────────────────────────────────────────

const BASE: ScheduleItemRow = {
  id: "row", title: "row", kind: "assignment", source: "ics", courseId: null,
  startAt: null, endAt: null, dueAt: null, allDay: 0,
  location: null, description: null, completedAt: null,
};

describe("toCalendarEvent — start is startAt ?? dueAt", () => {
  it("prefers startAt when the row carries a span", () => {
    const ev = toCalendarEvent({ ...BASE, startAt: at(12, 10), endAt: at(12, 11), dueAt: at(12, 23) }, null);
    expect(ev!.start).toBe(at(12, 10).toISOString());
    expect(ev!.end).toBe(at(12, 11).toISOString());
  });

  it("falls back to dueAt for a pure deadline, and leaves end null", () => {
    const ev = toCalendarEvent({ ...BASE, dueAt: at(12, 23, 59) }, null);
    expect(ev!.start).toBe(at(12, 23, 59).toISOString());
    expect(ev!.end).toBeNull();
  });

  it("drops a row with neither, rather than inventing a time", () => {
    expect(toCalendarEvent(BASE, null)).toBeNull();
  });

  it("maps the 0/1 allDay column onto a boolean", () => {
    expect(toCalendarEvent({ ...BASE, dueAt: at(12, 0), allDay: 1 }, null)!.allDay).toBe(true);
    expect(toCalendarEvent({ ...BASE, dueAt: at(12, 0) }, null)!.allDay).toBe(false);
  });

  it("reads the same rule through the database", async () => {
    const events = await listCalendarEvents(alice.id, WINDOW);
    const deadline = events.find((e) => e.id === deadlineId)!;
    expect(deadline.start).toBe(at(12, 23, 59).toISOString());
    expect(deadline.end).toBeNull();
    expect(deadline.courseName).toBe(course.name);
  });
});

// ── Grid arithmetic ──────────────────────────────────────────────────────────

describe("startOfWeek — Monday, matching the planning contract", () => {
  it("moves back to Monday from mid-week", () => {
    expect(dayKey(startOfWeek(new Date(2031, 2, 12)))).toBe("2031-03-10"); // Wed → Mon
  });
  it("leaves Monday alone", () => {
    expect(dayKey(startOfWeek(new Date(2031, 2, 10)))).toBe("2031-03-10");
  });
  it("treats Sunday as closing the week it ends, not opening the next", () => {
    expect(dayKey(startOfWeek(new Date(2031, 2, 16)))).toBe("2031-03-10"); // Sun → prior Mon
  });
});

describe("monthGridDays", () => {
  it("is always six rows of seven", () => {
    for (const month of [0, 1, 4, 7, 11]) {
      expect(monthGridDays(new Date(2031, month, 15))).toHaveLength(42);
    }
  });

  it("starts on the Monday on or before the first of the month", () => {
    // 1 March 2031 is a Saturday, so the grid opens on 24 February.
    const days = monthGridDays(new Date(2031, 2, 15));
    expect(dayKey(days[0]!)).toBe("2031-02-24");
    expect(days[0]!.getDay()).toBe(1);
  });

  it("covers the whole month with leading and trailing days on both ends", () => {
    const days = monthGridDays(new Date(2031, 2, 15));
    const keys = days.map(dayKey);
    expect(keys).toContain("2031-03-01");
    expect(keys).toContain("2031-03-31");
    expect(keys[41]).toBe("2031-04-06");
  });

  it("still starts on a Monday when the first IS a Monday", () => {
    // 1 September 2031 is a Monday — the grid must not add a blank leading week.
    const days = monthGridDays(new Date(2031, 8, 10));
    expect(dayKey(days[0]!)).toBe("2031-09-01");
  });

  it("keeps every cell at local midnight across a DST transition", () => {
    // US DST springs forward on 9 March 2031; millisecond arithmetic would put
    // some cells at 23:00 the previous day.
    for (const day of monthGridDays(new Date(2031, 2, 15))) {
      expect(day.getHours()).toBe(0);
      expect(day.getMinutes()).toBe(0);
    }
  });
});

describe("addMonths / step", () => {
  it("clamps rather than overflowing a short month", () => {
    expect(dayKey(addMonths(new Date(2031, 0, 31), 1))).toBe("2031-02-28");
  });
  it("steps a month, a week and a day per view", () => {
    const anchor = new Date(2031, 2, 12);
    expect(dayKey(step("month", anchor, 1))).toBe("2031-04-12");
    expect(dayKey(step("week", anchor, 1))).toBe("2031-03-19");
    expect(dayKey(step("day", anchor, -1))).toBe("2031-03-11");
  });
});

describe("rangeFor", () => {
  it("fetches exactly the 42 days a month grid renders", () => {
    const { from, to } = rangeFor("month", new Date(2031, 2, 15));
    expect(dayKey(from)).toBe("2031-02-24");
    expect(dayKey(to)).toBe("2031-04-07"); // exclusive end, one past the last cell
  });
  it("fetches Monday to Monday for a week", () => {
    const { from, to } = rangeFor("week", new Date(2031, 2, 12));
    expect(dayKey(from)).toBe("2031-03-10");
    expect(dayKey(to)).toBe("2031-03-17");
  });
  it("fetches one day for a day", () => {
    const { from, to } = rangeFor("day", new Date(2031, 2, 12, 15, 30));
    expect(dayKey(from)).toBe("2031-03-12");
    expect(dayKey(to)).toBe("2031-03-13");
  });
});

// ── Which day an event lands on ──────────────────────────────────────────────

function ev(partial: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: "e", title: "e", kind: "event", source: "ics", courseId: null, courseName: null,
    start: at(12, 10).toISOString(), end: null, allDay: false,
    location: null, description: null, completedAt: null, ...partial,
  };
}

describe("eventDayKeys", () => {
  it("puts a timed event on its local day", () => {
    expect(eventDayKeys(ev({ start: at(12, 10).toISOString(), end: at(12, 11).toISOString() })))
      .toEqual(["2031-03-12"]);
  });

  it("spans a timed event across every day it touches", () => {
    expect(eventDayKeys(ev({ start: at(12, 22).toISOString(), end: at(14, 2).toISOString() })))
      .toEqual(["2031-03-12", "2031-03-13", "2031-03-14"]);
  });

  it("does not spill an event ending exactly at midnight into the next day", () => {
    expect(eventDayKeys(ev({ start: at(12, 22).toISOString(), end: at(13, 0).toISOString() })))
      .toEqual(["2031-03-12"]);
  });

  it("renders an all-day event on its own date regardless of the viewer's offset", () => {
    // Stored as UTC midnight. Read with local getters in any zone west of
    // Greenwich this is the 11th; read as a date it is the 12th, which is what
    // the feed meant.
    const allDay = ev({ start: "2031-03-12T00:00:00.000Z", end: null, allDay: true });
    expect(eventDayKeys(allDay)).toEqual(["2031-03-12"]);
  });

  it("treats an all-day end as exclusive, the way ICS does", () => {
    // DTSTART 2031-03-12, DTEND 2031-03-13 is a ONE day event.
    const oneDay = ev({
      start: "2031-03-12T00:00:00.000Z", end: "2031-03-13T00:00:00.000Z", allDay: true,
    });
    expect(eventDayKeys(oneDay)).toEqual(["2031-03-12"]);

    const threeDay = ev({
      start: "2031-03-12T00:00:00.000Z", end: "2031-03-15T00:00:00.000Z", allDay: true,
    });
    expect(eventDayKeys(threeDay)).toEqual(["2031-03-12", "2031-03-13", "2031-03-14"]);
  });
});

describe("isPinnedRowEvent", () => {
  it("pins all-day items and pure deadlines above the clock", () => {
    expect(isPinnedRowEvent(ev({ allDay: true }))).toBe(true);
    expect(isPinnedRowEvent(ev({ end: null }))).toBe(true);
  });
  it("leaves a span on the time grid", () => {
    expect(isPinnedRowEvent(ev({ end: at(12, 11).toISOString() }))).toBe(false);
  });
});

// ── Overlap layout ───────────────────────────────────────────────────────────

const DAY = new Date(2031, 2, 12);

function span(id: string, fromHour: number, toHour: number): CalendarEvent {
  return ev({ id, start: at(12, fromHour).toISOString(), end: at(12, toHour).toISOString() });
}

describe("layoutDay — overlapping events sit side by side", () => {
  it("gives a lone event the full width", () => {
    const [slot] = layoutDay(DAY, [span("a", 10, 11)]);
    expect(slot).toMatchObject({ column: 0, columns: 1, startMin: 600, endMin: 660 });
  });

  it("splits two overlapping events into two columns", () => {
    const slots = layoutDay(DAY, [span("a", 10, 11), span("b", 10, 12)]);
    expect(slots.map((s) => s.column).sort()).toEqual([0, 1]);
    expect(slots.every((s) => s.columns === 2)).toBe(true);
  });

  it("gives back-to-back events the full width each", () => {
    const slots = layoutDay(DAY, [span("a", 10, 11), span("b", 11, 12)]);
    expect(slots.every((s) => s.columns === 1 && s.column === 0)).toBe(true);
  });

  it("reuses a freed column inside one cluster", () => {
    // b 9–12 runs all morning and anchors the left column (equal starts sort
    // longest-first); a 9–10 takes the second, and c 10–11 reuses it once a
    // has ended rather than opening a third.
    const slots = layoutDay(DAY, [span("a", 9, 10), span("b", 9, 12), span("c", 10, 11)]);
    const by = Object.fromEntries(slots.map((s) => [s.event.id, s]));
    expect(by.b!.column).toBe(0);
    expect(by.a!.column).toBe(1);
    expect(by.c!.column).toBe(1);
    expect(slots.every((s) => s.columns === 2)).toBe(true);
  });

  it("keeps separate clusters from inflating each other's width", () => {
    const slots = layoutDay(DAY, [span("a", 9, 10), span("b", 9, 10), span("c", 14, 15)]);
    const by = Object.fromEntries(slots.map((s) => [s.event.id, s]));
    expect(by.a!.columns).toBe(2);
    expect(by.c!.columns).toBe(1);
  });

  it("separates a 30-minute quiz from a 50-minute lecture starting together", () => {
    const quiz = ev({ id: "quiz", start: at(12, 13).toISOString(), end: at(12, 13, 30).toISOString() });
    const lecture = ev({ id: "lec", start: at(12, 13).toISOString(), end: at(12, 13, 50).toISOString() });
    const slots = layoutDay(DAY, [quiz, lecture]);
    expect(slots.every((s) => s.columns === 2)).toBe(true);
  });

  it("leaves pinned items out of the time grid entirely", () => {
    expect(layoutDay(DAY, [ev({ id: "d", end: null }), ev({ id: "ad", allDay: true })])).toEqual([]);
  });

  it("clips an event that runs in from the previous day", () => {
    const overnight = ev({
      id: "n", start: at(11, 22).toISOString(), end: at(12, 2).toISOString(),
    });
    const [slot] = layoutDay(DAY, [overnight]);
    expect(slot!.startMin).toBe(0);
    expect(slot!.endMin).toBe(120);
  });
});
