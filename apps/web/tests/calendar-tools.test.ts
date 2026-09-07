/**
 * Agent J5 — Layer 2 (contract F) and the four conversation-facing schedule
 * tools (contract E).
 *
 * Runs against the seeded local stack: `pnpm db:seed && pnpm db:seed:calendar`.
 *
 * `seed:calendar` lays its fixture semester out relative to the CURRENT week's
 * Monday, so which of its rows fall into "today" or "this week" depends on what
 * day the suite happens to run. Nothing here asserts against a row whose
 * horizon moves: the deterministic anchors are the two deadlines colliding on
 * day 10 and the exams at days 17/23, all of which are past `weekEnd`
 * (Monday + 7) on every weekday and therefore always land under Semester. Rows
 * this file needs on a specific horizon it inserts itself.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, like } from "drizzle-orm";
import { courses, db, planAmendments, plans, scheduleItems, tasks, users } from "@mola/db";
import { buildLayer2 } from "../lib/context/assemble";
import {
  addDays, addScheduleItemTool, completeTaskTool, localDateKey, readPlanTool,
  readScheduleTool, startOfLocalDay,
} from "../lib/agent/tools/calendar";
import { buildRegistry } from "../lib/agent/tools";
import type { ToolContext } from "../lib/agent/registry";

const EMPTY_EMAIL = "j5-empty@test.invalid";

let alice: { id: string }, bob: { id: string }, empty: { id: string };
let aliceCourseId: string;
/** An open, seeded assignment of alice's — the cross-user check-off target. */
let aliceOpenItemId: string;
let dayPlanId: string;
/** Everything this file wrote, torn down in afterAll. */
const madeItems: string[] = [];
const madeTasks: string[] = [];

let aliceCtx: ToolContext, bobCtx: ToolContext, emptyCtx: ToolContext;

const today = startOfLocalDay(new Date());

beforeAll(async () => {
  const [a] = await db.select().from(users).where(eq(users.email, "alice@umbc.edu"));
  const [b] = await db.select().from(users).where(eq(users.email, "bob@umbc.edu"));
  if (!a || !b) throw new Error("run `pnpm db:seed` first");
  alice = a;
  bob = b;

  const [c] = await db.select().from(courses)
    .where(and(eq(courses.userId, alice.id), eq(courses.number, "CMSC 421")));
  if (!c) throw new Error("run `pnpm db:seed` first");
  aliceCourseId = c.id;

  const mock = await db.select().from(scheduleItems)
    .where(and(eq(scheduleItems.userId, alice.id), like(scheduleItems.externalId, "mock-%")));
  if (mock.length === 0) throw new Error("run `pnpm db:seed:calendar` first");

  const hw4 = mock.find((m) => m.externalId === "mock-os-hw4");
  if (!hw4) throw new Error("expected the mock-os-hw4 fixture row");
  aliceOpenItemId = hw4.id;

  // A user with genuinely nothing. Created rather than reusing bob so the
  // empty-Layer-2 assertions cannot be quietly invalidated by another suite
  // writing a chat or a course against a shared fixture account.
  const [e] = await db.insert(users)
    .values({ email: EMPTY_EMAIL, name: "Empty" }).returning();
  empty = e!;

  // Pinned to today so the "## Today" assertions hold on any weekday.
  const [dueToday] = await db.insert(scheduleItems).values({
    userId: alice.id,
    courseId: aliceCourseId,
    kind: "assignment",
    source: "student",
    title: "J5TEST Reading response",
    dueAt: new Date(today.getTime() + 17 * 3_600_000),
    allDay: 0,
  }).returning();
  madeItems.push(dueToday!.id);

  const [plan] = await db.insert(plans).values({
    userId: alice.id,
    horizon: "day",
    periodStart: today,
    periodEnd: addDays(today, 1),
    status: "approved",
    payload: {
      horizon: "day",
      date: localDateKey(today),
      summary: "J5TEST two eigenvalue blocks, then the shell parser.",
      items: [],
    },
  }).returning();
  dayPlanId = plan!.id;

  const made = await db.insert(tasks).values([
    {
      userId: alice.id, planId: dayPlanId, planItemId: "j5-p1",
      title: "J5TEST eigenvalue drill", status: "todo", source: "plan",
      scheduledFor: today, estimatedMinutes: 45,
    },
    {
      userId: alice.id, planId: dayPlanId, planItemId: "j5-p2",
      title: "J5TEST shell parser skeleton", status: "done", source: "plan",
      scheduledFor: today, completedAt: new Date(),
    },
  ]).returning();
  madeTasks.push(...made.map((t) => t.id));

  const session = (u: { id: string }, email: string) => ({ userId: u.id, email });
  aliceCtx = { session: session(alice, "alice@umbc.edu"), chatId: "unused", courseId: null };
  bobCtx = { session: session(bob, "bob@umbc.edu"), chatId: "unused", courseId: null };
  emptyCtx = { session: session(empty, EMPTY_EMAIL), chatId: "unused", courseId: null };
});

afterAll(async () => {
  if (madeTasks.length) await db.delete(tasks).where(inArray(tasks.id, madeTasks));
  if (dayPlanId) await db.delete(plans).where(eq(plans.id, dayPlanId));
  const chatWritten = await db.select({ id: scheduleItems.id }).from(scheduleItems)
    .where(and(eq(scheduleItems.userId, alice.id), eq(scheduleItems.source, "chat")));
  const ids = [...madeItems, ...chatWritten.map((r) => r.id)];
  if (ids.length) await db.delete(scheduleItems).where(inArray(scheduleItems.id, ids));
  // Cascades to the empty user's rows, of which there should be none.
  if (empty) await db.delete(users).where(eq(users.id, empty.id));
});

describe("contract F — Layer 2 for a student with a plan and a calendar", () => {
  it("keeps the three horizon headings", async () => {
    const text = await buildLayer2(alice.id);
    expect(text).toContain("# Schedule");
    expect(text).toContain("## Today");
    expect(text).toContain("## This week");
    expect(text).toContain("## Semester");
  });

  it("surfaces the approved day plan and its open work under Today", async () => {
    const text = await buildLayer2(alice.id);
    const todaySection = section(text, "## Today");
    expect(todaySection).toContain("J5TEST two eigenvalue blocks");
    expect(todaySection).toContain("J5TEST eigenvalue drill");
    expect(todaySection).toContain("Due today: ");
    expect(todaySection).toContain("J5TEST Reading response");
    // The done one is counted, not listed again as outstanding.
    expect(todaySection).toContain("1 of 2 done.");
  });

  it("shows real seeded events, with two colliding deadlines on one line", async () => {
    const text = await buildLayer2(alice.id);
    const semester = section(text, "## Semester");
    const collision = semester
      .split("\n")
      .find((l) => l.includes("Homework 4: Deadlock detection"));
    expect(collision).toBeDefined();
    // Both fixture deadlines land on the same day; a Layer 2 that split them
    // across two lines would hide exactly the clash the tutor should mention.
    expect(collision).toContain("MATH 221 — Problem Set 5");
    expect(semester).toContain("MATH 221 — Midterm 2");
    expect(semester).toContain("CMSC 421 — Midterm");
  });

  it("prints times in local human form, never ISO", async () => {
    const text = await buildLayer2(alice.id);
    expect(text).toMatch(/due 11:59pm/);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(text).not.toMatch(/GMT|UTC|[+-]\d{2}:\d{2}\b/);
  });

  it("stays small enough to stamp into every request", async () => {
    const text = await buildLayer2(alice.id);
    // 35 fixture events plus a plan. A block that dumped the calendar would be
    // several times this; the budget is what forces the summarising.
    expect(text.length).toBeLessThan(1600);
  });
});

describe("contract F — Layer 2 for a student with nothing", () => {
  it("keeps the three headings and says plainly that there is no plan", async () => {
    const text = await buildLayer2(empty.id);
    expect(text).toContain("## Today");
    expect(text).toContain("## This week");
    expect(text).toContain("## Semester");
    expect(text).toContain("No study plan has been proposed yet");
    expect(text.length).toBeLessThan(400);
  });

  it("invents no dates in its body", async () => {
    const text = await buildLayer2(empty.id);
    // The `Now:` line and the "## This week (through …)" heading carry real
    // dates by design — they say what window the horizons mean. Everything
    // below them is claims about the student, and there is nothing to claim.
    const body = text.split("\n")
      .filter((l) => l && !l.startsWith("Now:") && !l.startsWith("#"))
      .join("\n");
    expect(body).not.toMatch(/\d{1,2}:\d{2}(am|pm)/);
    expect(body).not.toMatch(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/);
    expect(body).not.toMatch(/\bdue\b/);
  });

  it("does not leak another student's calendar", async () => {
    const text = await buildLayer2(empty.id);
    expect(text).not.toContain("CMSC 421");
    expect(text).not.toContain("MATH 221");
  });
});

describe("contract E — add_schedule_item", () => {
  it("refuses a vague date instead of guessing a day", async () => {
    const before = await countItems(alice.id);
    const result = await addScheduleItemTool.execute(
      { title: "Essay draft", date: "sometime next week", kind: "deadline" },
      aliceCtx,
    ) as { needsClarification?: boolean; question?: string; created?: unknown };

    expect(result.needsClarification).toBe(true);
    expect(result.created).toBeUndefined();
    expect(result.question).toMatch(/ask/i);
    // The refusal has to be a refusal: nothing may reach the calendar.
    expect(await countItems(alice.id)).toBe(before);
  });

  it("refuses a date that looks specific but is not a real day", async () => {
    const result = await addScheduleItemTool.execute(
      { title: "Essay draft", date: "2026-02-31", kind: "deadline" },
      aliceCtx,
    ) as { needsClarification?: boolean };
    expect(result.needsClarification).toBe(true);
  });

  it("writes an exact date with source \"chat\"", async () => {
    const when = localDateKey(addDays(today, 5));
    const result = await addScheduleItemTool.execute(
      {
        title: "J5TEST Essay draft", date: when, time: "14:30",
        kind: "deadline", courseId: aliceCourseId,
      },
      aliceCtx,
    ) as { created: { id: string; when: string; source: string } };

    expect(result.created.source).toBe("chat");
    expect(result.created.when).toMatch(/2:30pm/);

    const [row] = await db.select().from(scheduleItems)
      .where(eq(scheduleItems.id, result.created.id));
    expect(row!.source).toBe("chat");
    expect(row!.userId).toBe(alice.id);
    expect(row!.courseId).toBe(aliceCourseId);
    // Contract A: a pure deadline sets dueAt and leaves startAt null.
    expect(row!.dueAt).not.toBeNull();
    expect(row!.startAt).toBeNull();
  });

  it("stores an omitted clock time as all-day rather than inventing 11:59pm", async () => {
    const result = await addScheduleItemTool.execute(
      { title: "J5TEST Undated reading", date: localDateKey(addDays(today, 6)), kind: "deadline" },
      aliceCtx,
    ) as { created: { id: string; when: string } };

    expect(result.created.when).toContain("(all day)");
    const [row] = await db.select().from(scheduleItems)
      .where(eq(scheduleItems.id, result.created.id));
    expect(row!.allDay).toBe(1);
  });
});

describe("contract E — complete_task", () => {
  it("reports what it found instead of picking one when the match is ambiguous", async () => {
    const result = await completeTaskTool.execute({ title: "problem set" }, aliceCtx) as {
      ambiguous?: boolean;
      matches?: { id: string; title: string }[];
      completed?: unknown;
    };

    expect(result.ambiguous).toBe(true);
    expect(result.completed).toBeUndefined();
    const titles = (result.matches ?? []).map((m) => m.title);
    expect(titles).toContain("MATH 221 — Problem Set 4");
    expect(titles).toContain("MATH 221 — Problem Set 5");

    // Nothing may be checked off on an ambiguous match.
    const still = await db.select().from(scheduleItems)
      .where(and(eq(scheduleItems.userId, alice.id), like(scheduleItems.title, "%Problem Set%")));
    for (const r of still.filter((x) => !x.title.includes("Set 3"))) {
      expect(r.completedAt).toBeNull();
    }
  });

  it("says so plainly when nothing matches", async () => {
    const result = await completeTaskTool.execute(
      { title: "topology homework" }, aliceCtx,
    ) as { completed: null; note: string };
    expect(result.completed).toBeNull();
    expect(result.note).toMatch(/Ask the student/i);
  });

  it("does not check something off on one incidental word in common", async () => {
    // "essay" alone overlaps the Essay draft written above. Being the only
    // candidate with any overlap at all is not evidence it is the right one,
    // and checking it off silently un-does real work.
    const result = await completeTaskTool.execute(
      { title: "quantum chromodynamics essay" }, aliceCtx,
    ) as { completed: null; note: string };
    expect(result.completed).toBeNull();

    const [row] = await db.select().from(scheduleItems)
      .where(and(eq(scheduleItems.userId, alice.id), eq(scheduleItems.title, "J5TEST Essay draft")));
    expect(row!.completedAt).toBeNull();
  });

  it("checks off a single unambiguous task and logs a completed amendment", async () => {
    const result = await completeTaskTool.execute(
      { title: "J5TEST eigenvalue drill" }, aliceCtx,
    ) as { completed: { id: string } };

    expect(result.completed.id).toBe(madeTasks[0]);
    const [row] = await db.select().from(tasks).where(eq(tasks.id, madeTasks[0]!));
    expect(row!.status).toBe("done");
    expect(row!.completedAt).not.toBeNull();

    // §5's feedback loop: the end-of-week review reads plan_amendments, so a
    // completion that never lands here is invisible to it.
    const log = await db.select().from(planAmendments)
      .where(and(eq(planAmendments.planId, dayPlanId), eq(planAmendments.action, "completed")));
    expect(log).toHaveLength(1);
    expect(log[0]!.itemId).toBe("j5-p1");
  });
});

describe("§9 — a tool is not exempt because a model called it", () => {
  it("read_schedule returns only the caller's own events", async () => {
    const mine = await readScheduleTool.execute({}, aliceCtx) as { events: unknown[] };
    expect(mine.events.length).toBeGreaterThan(0);

    const theirs = await readScheduleTool.execute({}, bobCtx) as {
      events: { title: string }[]; note?: string;
    };
    expect(theirs.events).toEqual([]);
    expect(theirs.note).toBeDefined();
  });

  it("read_schedule denies a course belonging to someone else", async () => {
    const result = await readScheduleTool.execute({ courseId: aliceCourseId }, bobCtx) as {
      error?: string;
    };
    expect(result.error).toBe("Course not found.");
  });

  it("read_plan does not return another student's plan", async () => {
    const mine = await readPlanTool.execute(
      { horizon: "day", date: localDateKey(today) }, aliceCtx,
    ) as { summary?: string | null };
    expect(mine.summary).toContain("J5TEST");

    const theirs = await readPlanTool.execute(
      { horizon: "day", date: localDateKey(today) }, bobCtx,
    ) as { plan: null; note: string };
    expect(theirs.plan).toBeNull();
    expect(theirs.note).toMatch(/Do not invent one/);
  });

  it("add_schedule_item refuses to file against another student's course", async () => {
    const before = await countItems(bob.id);
    const result = await addScheduleItemTool.execute(
      {
        title: "J5TEST cross-user write", date: localDateKey(addDays(today, 2)),
        kind: "deadline", courseId: aliceCourseId,
      },
      bobCtx,
    ) as { error?: string; created?: unknown };

    expect(result.error).toBe("Course not found.");
    expect(result.created).toBeUndefined();
    expect(await countItems(bob.id)).toBe(before);
  });

  it("complete_task cannot check off another student's assignment", async () => {
    const result = await completeTaskTool.execute({ id: aliceOpenItemId }, bobCtx) as {
      error: string;
    };
    expect(result.error).toBe("No open task or assignment with that id.");

    const [row] = await db.select().from(scheduleItems).where(eq(scheduleItems.id, aliceOpenItemId));
    expect(row!.completedAt).toBeNull();
  });

  it("complete_task gives a foreign id and a missing id the same answer", async () => {
    const foreign = await completeTaskTool.execute({ id: aliceOpenItemId }, bobCtx) as { error: string };
    const missing = await completeTaskTool.execute(
      { id: "00000000-0000-0000-0000-000000000000" }, bobCtx,
    ) as { error: string };
    expect(foreign.error).toBe(missing.error);
  });
});

describe("registration", () => {
  it("registers all four schedule tools on the live registry", () => {
    const names = buildRegistry().catalog().map((t) => t.name);
    expect(names).toContain("read_schedule");
    expect(names).toContain("read_plan");
    expect(names).toContain("add_schedule_item");
    expect(names).toContain("complete_task");
  });

  it("keeps every description to the single line Layer 3 injects", () => {
    const four = buildRegistry().catalog().filter((t) =>
      ["read_schedule", "read_plan", "add_schedule_item", "complete_task"].includes(t.name));
    expect(four).toHaveLength(4);
    for (const t of four) expect(t.description).not.toContain("\n");
  });
});

/** The lines under one `## heading`, up to the next one. */
function section(text: string, heading: string): string {
  const lines = text.split("\n");
  const start = lines.indexOf(heading);
  if (start === -1) throw new Error(`no ${heading} section in Layer 2`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

async function countItems(userId: string): Promise<number> {
  const rows = await db.select({ id: scheduleItems.id }).from(scheduleItems)
    .where(eq(scheduleItems.userId, userId));
  return rows.length;
}
