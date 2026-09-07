/**
 * Mock semester for Agent J (calendar + planning). Run after `pnpm db:seed`.
 *
 *   pnpm --filter @mola/db seed:calendar
 *
 * Everything is generated RELATIVE TO TODAY rather than pinned to fixed dates,
 * so the week view is never empty no matter when this is run — a fixture
 * calendar whose events are all in the past is useless for looking at a
 * "this week" surface, which is most of what there is to look at here.
 *
 * Idempotent: every row carries a `mock-` external id and is re-upserted on
 * that key, so re-running reshuffles the semester onto the current week
 * instead of accumulating duplicates.
 */
import { and, eq, like } from "drizzle-orm";
import { db } from "./client";
import { calendarSources, courses, scheduleItems, users } from "./schema";

const [alice] = await db.select().from(users).where(eq(users.email, "alice@umbc.edu")).limit(1);
if (!alice) throw new Error("run `pnpm db:seed` first — alice@umbc.edu does not exist");

const enrolled = await db.select().from(courses).where(eq(courses.userId, alice.id));
const os = enrolled.find((c) => c.number === "CMSC 421");
if (!os) throw new Error("expected CMSC 421 — run `pnpm db:seed` first");

/**
 * The base seed creates one course. A planner with a single course cannot show
 * the thing it exists to show — competing demands ACROSS courses — so the
 * second one is created here rather than assumed to be present.
 */
const la = enrolled.find((c) => c.number === "MATH 221")
  ?? (await db.insert(courses).values({
    userId: alice.id,
    termId: os.termId,
    name: "Linear Algebra",
    number: "MATH 221",
    professor: "Dr. Reyes",
    summary:
      "Vector spaces, linear maps, eigenvalues and diagonalization, with an "
      + "applied slant toward least squares and Markov chains. Weekly problem "
      + "sets, three in-term quizzes and two midterms.",
    instructions: "Show the work, not just the result. Prefers geometric intuition before algebra.",
  }).returning())[0]!;

// ── Date helpers ─────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** Monday of the current week, local midnight. */
function mondayOfThisWeek(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  // getDay(): 0=Sun … 6=Sat. Sunday belongs to the week that just ended.
  const shift = d.getDay() === 0 ? -6 : 1 - d.getDay();
  return new Date(d.getTime() + shift * DAY_MS);
}

const MONDAY = mondayOfThisWeek();

/** `at(7, 14, 30)` → 2:30pm on the 8th day after this Monday. */
function at(dayOffset: number, hour: number, minute = 0): Date {
  const d = new Date(MONDAY.getTime() + dayOffset * DAY_MS);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function plusMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60_000);
}

// ── The mock feed ────────────────────────────────────────────────────────────

const [source] = await db.insert(calendarSources).values({
  userId: alice.id,
  kind: "ics",
  name: "Blackboard — Fall 2026 (mock)",
  url: "file://fixtures/blackboard-fall-2026.ics",
  status: "active",
  lastSyncedAt: new Date(),
}).onConflictDoNothing().returning();

const sourceRow = source ?? (await db.select().from(calendarSources)
  .where(and(eq(calendarSources.userId, alice.id), eq(calendarSources.kind, "ics")))
  .limit(1))[0]!;

type Row = typeof scheduleItems.$inferInsert;

const rows: Row[] = [];

function push(r: Omit<Row, "userId" | "externalId"> & { key: string }) {
  const { key, ...rest } = r;
  rows.push({ ...rest, userId: alice.id, externalId: `mock-${key}` });
}

// Recurring lectures — CMSC 421 Mon/Wed/Fri 10:00, MATH 221 Tue/Thu 13:00.
// Written out as concrete sittings for four weeks rather than as an RRULE:
// the calendar UI reads rows, and expanding recurrence is not what this
// fixture is here to exercise.
for (let week = 0; week < 4; week++) {
  const base = week * 7;
  for (const [dayOffset, label] of [[0, "Mon"], [2, "Wed"], [4, "Fri"]] as const) {
    const start = at(base + dayOffset, 10);
    push({
      key: `os-lecture-w${week}-${label}`,
      courseId: os.id, calendarSourceId: sourceRow.id,
      kind: "class", source: "ics",
      title: "CMSC 421 Lecture",
      startAt: start, endAt: plusMinutes(start, 50), dueAt: start,
      location: "ITE 227",
    });
  }
  for (const [dayOffset, label] of [[1, "Tue"], [3, "Thu"]] as const) {
    const start = at(base + dayOffset, 13);
    push({
      key: `la-lecture-w${week}-${label}`,
      courseId: la.id, calendarSourceId: sourceRow.id,
      kind: "class", source: "ics",
      title: "MATH 221 Lecture",
      startAt: start, endAt: plusMinutes(start, 75), dueAt: start,
      location: "MP 106",
    });
  }
}

// Deadlines and sittings across the next three weeks. The shape matters more
// than the specifics: something due in the next 48h, a quiz mid-week, two
// deadlines colliding on one day (Thursday of week 2), and an exam far enough
// out that the semester horizon has something to point at.
push({
  key: "os-hw3",
  courseId: os.id, calendarSourceId: sourceRow.id,
  kind: "assignment", source: "ics",
  title: "CMSC 421 — Project 1: Shell implementation",
  dueAt: at(3, 23, 59),
  description: "Implement job control, pipes, and redirection. Submit via GitHub Classroom.",
});
push({
  key: "la-ps4",
  courseId: la.id, calendarSourceId: sourceRow.id,
  kind: "assignment", source: "ics",
  title: "MATH 221 — Problem Set 4",
  dueAt: at(2, 23, 59),
  description: "§4.1–4.3: eigenvalues, eigenvectors, diagonalization.",
});
push({
  key: "la-quiz3",
  courseId: la.id, calendarSourceId: sourceRow.id,
  kind: "exam", source: "ics",
  title: "MATH 221 — Quiz 3 (eigenvalues)",
  startAt: at(3, 13), endAt: at(3, 13, 30), dueAt: at(3, 13),
  location: "MP 106",
});
push({
  key: "os-quiz2",
  courseId: os.id, calendarSourceId: sourceRow.id,
  kind: "exam", source: "ics",
  title: "CMSC 421 — Quiz 2 (scheduling & synchronization)",
  startAt: at(9, 10), endAt: at(9, 10, 50), dueAt: at(9, 10),
  location: "ITE 227",
});
push({
  key: "os-hw4",
  courseId: os.id, calendarSourceId: sourceRow.id,
  kind: "assignment", source: "ics",
  title: "CMSC 421 — Homework 4: Deadlock detection",
  dueAt: at(10, 23, 59),
});
push({
  key: "la-ps5",
  courseId: la.id, calendarSourceId: sourceRow.id,
  kind: "assignment", source: "ics",
  title: "MATH 221 — Problem Set 5",
  dueAt: at(10, 23, 59),
  description: "Two deadlines land on the same Thursday — deliberate, the planner should notice.",
});
push({
  key: "la-midterm2",
  courseId: la.id, calendarSourceId: sourceRow.id,
  kind: "exam", source: "ics",
  title: "MATH 221 — Midterm 2",
  startAt: at(17, 13), endAt: at(17, 14, 15), dueAt: at(17, 13),
  location: "MP 106",
});
push({
  key: "os-midterm",
  courseId: os.id, calendarSourceId: sourceRow.id,
  kind: "exam", source: "ics",
  title: "CMSC 421 — Midterm",
  startAt: at(23, 10), endAt: at(23, 11, 15), dueAt: at(23, 10),
  location: "ITE 227",
});
push({
  key: "os-project2",
  courseId: os.id, calendarSourceId: sourceRow.id,
  kind: "assignment", source: "ics",
  title: "CMSC 421 — Project 2: Virtual memory",
  dueAt: at(28, 23, 59),
});

// Two already-completed items, so the check-off state has something to render
// in a non-empty state on first look.
push({
  key: "la-ps3-done",
  courseId: la.id, calendarSourceId: sourceRow.id,
  kind: "assignment", source: "ics",
  title: "MATH 221 — Problem Set 3",
  dueAt: at(-4, 23, 59),
  completedAt: at(-4, 21),
});
push({
  key: "os-hw2-done",
  courseId: os.id, calendarSourceId: sourceRow.id,
  kind: "assignment", source: "ics",
  title: "CMSC 421 — Homework 3: Page replacement",
  dueAt: at(-2, 23, 59),
  completedAt: at(-2, 22, 30),
});

// Non-course commitments — a planner that schedules study time on top of a
// shift or a standing appointment is not usable, so the fixture includes some.
push({
  key: "work-shift-1",
  courseId: null, calendarSourceId: sourceRow.id,
  kind: "event", source: "google",
  title: "Work shift — campus library",
  startAt: at(1, 16), endAt: at(1, 20), dueAt: at(1, 16),
  location: "AOK Library",
});
push({
  key: "work-shift-2",
  courseId: null, calendarSourceId: sourceRow.id,
  kind: "event", source: "google",
  title: "Work shift — campus library",
  startAt: at(4, 16), endAt: at(4, 20), dueAt: at(4, 16),
  location: "AOK Library",
});
push({
  key: "study-group",
  courseId: la.id, calendarSourceId: sourceRow.id,
  kind: "event", source: "google",
  title: "MATH 221 study group",
  startAt: at(2, 18), endAt: at(2, 19, 30), dueAt: at(2, 18),
  location: "AOK 3rd floor",
});
push({
  key: "office-hours",
  courseId: os.id, calendarSourceId: sourceRow.id,
  kind: "event", source: "ics",
  title: "CMSC 421 office hours",
  startAt: at(1, 14), endAt: at(1, 16), dueAt: at(1, 14),
  location: "ITE 349",
});

// Upsert on (userId, source, externalId) — the unique index the real ICS sync
// dedupes on, so re-running this exercises the same path a re-sync takes.
for (const row of rows) {
  await db.insert(scheduleItems).values(row).onConflictDoUpdate({
    target: [scheduleItems.userId, scheduleItems.source, scheduleItems.externalId],
    set: {
      title: row.title, kind: row.kind, courseId: row.courseId ?? null,
      startAt: row.startAt ?? null, endAt: row.endAt ?? null, dueAt: row.dueAt ?? null,
      location: row.location ?? null, description: row.description ?? null,
      completedAt: row.completedAt ?? null, calendarSourceId: row.calendarSourceId ?? null,
      updatedAt: new Date(),
    },
  });
}

const total = await db.select().from(scheduleItems).where(like(scheduleItems.externalId, "mock-%"));
console.log(`seeded ${total.length} mock schedule items for alice@umbc.edu`);
console.log(`week of ${MONDAY.toDateString()} — lectures, 2 quizzes, 2 midterms, 6 deadlines, 4 personal events`);
process.exit(0);
