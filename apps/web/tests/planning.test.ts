/**
 * Contract 7 (payload validation) and the propose → amend → accept gate (§5),
 * exercised against the real seeded DB with the LLM call stubbed out — same
 * discipline as tests/compaction.test.ts: a suite that needs a live 27B model
 * up is a suite nobody runs.
 *
 * Requires the local stack, same as tests/contracts.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  courses, db, planAmendments, plans, tasks, users,
} from "@mola/db";
import { AuthzError } from "../lib/auth/ownership";
import { dateKey, mondayOf, startOfDay } from "../lib/planning/dates";
import { generateDayPlan, PlanGenerationError, type PlanCompleter } from "../lib/planning/generate";
import {
  acceptPlan, amendPlan, createTask, getCurrentPlanRow, updateTask,
} from "../lib/planning/lifecycle";
import { describeAmendmentPattern, gatherWeekAmendments } from "../lib/planning/review";
import { proposeWeekHandler } from "../lib/jobs/handlers/plan-week-propose";

let alice: { id: string; email: string };
let bob: { id: string; email: string };
let course: { id: string };

const cleanupPlanIds: string[] = [];

beforeAll(async () => {
  const [a] = await db.select().from(users).where(eq(users.email, "alice@umbc.edu"));
  const [b] = await db.select().from(users).where(eq(users.email, "bob@umbc.edu"));
  if (!a || !b) throw new Error("run `pnpm db:seed` first");
  alice = { id: a.id, email: a.email };
  bob = { id: b.id, email: b.email };

  const [c] = await db.select().from(courses).where(eq(courses.userId, alice.id));
  if (!c) throw new Error("run `pnpm db:seed` first");
  course = c;
});

afterAll(async () => {
  // plan_amendments cascades on plan delete, but tasks.planId is
  // onDelete:"set null" (schema.ts) — a plan-sourced task survives its plan
  // being deleted, orphaned with planId=null, which is precisely the "task
  // materialisation" behaviour under test here. Deleting tasks by planId
  // first, before the plan itself is gone, is what actually cleans them up;
  // relying on a cascade that doesn't exist left "Read chapter 4" and
  // "Problem set" sitting in the real Plan tab as if a student had them.
  if (cleanupPlanIds.length > 0) {
    await db.delete(tasks).where(inArray(tasks.planId, cleanupPlanIds));
  }
  for (const id of cleanupPlanIds) {
    await db.delete(plans).where(eq(plans.id, id));
  }
});

async function insertPlan(overrides: Partial<typeof plans.$inferInsert> & { userId: string }) {
  const [row] = await db.insert(plans).values({
    horizon: "day",
    periodStart: startOfDay(new Date()),
    status: "proposed",
    payload: { horizon: "day", date: dateKey(new Date()), items: [] },
    ...overrides,
  }).returning();
  cleanupPlanIds.push(row!.id);
  return row!;
}

// ── Contract 7 — zod validation at the LLM boundary ─────────────────────────

describe("generateDayPlan — payload validation (contract 7)", () => {
  const date = dateKey(addDays(1));

  function addDays(n: number): Date {
    return new Date(startOfDay(new Date()).getTime() + n * 86_400_000);
  }

  it("rejects a malformed payload and retries once with the issue list fed back, then succeeds", async () => {
    const calls: { system: string; prompt: string }[] = [];
    const completer: PlanCompleter = async (req) => {
      calls.push(req);
      if (calls.length === 1) {
        // A `kind` outside the enum — the exact "eventually emits" case
        // generate.ts's own comment names.
        return JSON.stringify({
          horizon: "day", date, items: [{ title: "Read chapter 4", kind: "napping" }],
        });
      }
      return JSON.stringify({
        horizon: "day", date, items: [{ title: "Read chapter 4", kind: "reading", estimatedMinutes: 30 }],
      });
    };

    const payload = await generateDayPlan({ userId: alice.id, date, weekPlan: null }, completer);

    expect(calls).toHaveLength(2);
    // The retry prompt quotes the rejection back at the model — that is the
    // "fed back" half of the contract, not just "tries again blind".
    expect(calls[1]!.prompt).toContain("rejected");
    expect(calls[1]!.prompt).toContain("kind");
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]!.kind).toBe("reading");
    // Ids are derived, never trusted from the model (generate.ts's own rule).
    expect(payload.items[0]!.id).toBeTruthy();
  });

  it("gives up after exactly one retry — a model that fails the shape twice does not get a third try", async () => {
    let attempts = 0;
    const alwaysBad: PlanCompleter = async () => {
      attempts++;
      return JSON.stringify({ horizon: "day", date, items: [{ title: "x", kind: "not-a-real-kind" }] });
    };

    await expect(
      generateDayPlan({ userId: alice.id, date, weekPlan: null }, alwaysBad),
    ).rejects.toBeInstanceOf(PlanGenerationError);
    expect(attempts).toBe(2);
  });
});

// ── Task materialisation — idempotent on (planId, planItemId) ──────────────

describe("acceptPlan — task materialisation (contract A's uniqueIndex(planId, planItemId))", () => {
  it("does not duplicate tasks when the same plan is accepted twice", async () => {
    const date = dateKey(startOfDay(new Date()));
    const plan = await insertPlan({
      userId: alice.id,
      horizon: "day",
      periodStart: startOfDay(new Date()),
      payload: {
        horizon: "day",
        date,
        items: [
          { id: "fixed-item-1", title: "Read chapter 4", kind: "reading", estimatedMinutes: 30 },
          { id: "fixed-item-2", title: "Problem set", kind: "homework", estimatedMinutes: 60 },
        ],
      },
    });

    const session = { userId: alice.id, email: alice.email };
    await acceptPlan(session, plan.id);
    const afterFirst = await db.select().from(tasks).where(eq(tasks.planId, plan.id));
    expect(afterFirst).toHaveLength(2);

    // Re-accept — this is the case §5's gate has to survive: a student
    // reloading the accept page, or a retried request, must not double the list.
    await acceptPlan(session, plan.id);
    const afterSecond = await db.select().from(tasks).where(eq(tasks.planId, plan.id));
    expect(afterSecond).toHaveLength(2);
    expect(afterSecond.map((t) => t.id).sort()).toEqual(afterFirst.map((t) => t.id).sort());
  });
});

// ── Amendment log — written from both entry points §5 promises ─────────────

describe("plan_amendments — written by /api/plan/:id/amend and by task completion", () => {
  it("amendPlan writes a log row and applies the change to the payload", async () => {
    const date = dateKey(startOfDay(new Date()));
    const plan = await insertPlan({
      userId: alice.id,
      horizon: "day",
      periodStart: startOfDay(new Date()),
      payload: {
        horizon: "day",
        date,
        items: [{ id: "amend-me", title: "Read chapter 4", kind: "reading", estimatedMinutes: 30 }],
      },
    });

    const session = { userId: alice.id, email: alice.email };
    const updated = await amendPlan(session, plan.id, [
      { itemId: "amend-me", action: "resized", after: { estimatedMinutes: 45 }, reason: "took longer than planned" },
    ]);

    expect(updated.status).toBe("amended");
    if (updated.payload.horizon === "day") {
      expect(updated.payload.items[0]!.estimatedMinutes).toBe(45);
    } else {
      throw new Error("expected a day payload");
    }

    const rows = await db.select().from(planAmendments).where(eq(planAmendments.planId, plan.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe("resized");
    expect(rows[0]!.reason).toBe("took longer than planned");
  });

  it("checking off a plan-sourced task writes a completed amendment, not silently", async () => {
    const date = dateKey(startOfDay(new Date()));
    const plan = await insertPlan({
      userId: alice.id,
      horizon: "day",
      periodStart: startOfDay(new Date()),
      payload: {
        horizon: "day",
        date,
        items: [{ id: "complete-me", title: "Finish reading", kind: "reading", estimatedMinutes: 20 }],
      },
      status: "approved",
      approvedAt: new Date(),
    });

    const session = { userId: alice.id, email: alice.email };
    await acceptPlan(session, plan.id);
    const [task] = await db.select().from(tasks)
      .where(and(eq(tasks.planId, plan.id), eq(tasks.planItemId, "complete-me")));
    expect(task).toBeTruthy();

    await updateTask(session, task!.id, { status: "done" });

    const rows = await db.select().from(planAmendments)
      .where(and(eq(planAmendments.planId, plan.id), eq(planAmendments.itemId, "complete-me")));
    const completedRow = rows.find((r) => r.action === "completed");
    expect(completedRow).toBeTruthy();
  });
});

// ── The end-of-week review reads a pattern, not a diff ──────────────────────

describe("describeAmendmentPattern — the review reads repetition, not a payload diff", () => {
  it("surfaces a repeated reschedule as a count, which a raw diff of two payloads cannot", async () => {
    const date = dateKey(startOfDay(new Date()));
    // Any plan row satisfies plan_amendments' FK — deliberately NOT the same
    // (userId, horizon="week", periodStart) fixture the propose test below
    // uses, so the two tests' rows cannot collide on that trio.
    const plan = await insertPlan({
      userId: alice.id, horizon: "day", periodStart: startOfDay(new Date()),
      payload: { horizon: "day", date, items: [] },
    });

    // The same block, rescheduled three separate times — the signal §5 says
    // only the amendment log (not a before/after diff of the stored payload,
    // which would just show the LAST move) can surface.
    for (let i = 0; i < 3; i++) {
      await db.insert(planAmendments).values({
        userId: alice.id, planId: plan.id, itemId: "reading-block",
        action: "rescheduled",
        before: { title: "MATH 221 reading" }, after: { startAt: `slot-${i}` },
        reason: i === 2 ? "kept conflicting with work" : null,
      });
    }
    await db.insert(planAmendments).values({
      userId: alice.id, planId: plan.id, itemId: "other-block",
      action: "skipped", before: { title: "CMSC 421 practice quiz" }, after: null, reason: null,
    });

    const rows = await gatherWeekAmendments(alice.id, date);
    expect(rows.length).toBeGreaterThanOrEqual(4);

    const pattern = describeAmendmentPattern(rows);
    // The count is the whole point: one rescheduled block is a bad Tuesday,
    // the same block three times is a plan that was wrong about the student.
    expect(pattern).toContain("×3");
    expect(pattern).toContain("MATH 221 reading");
    expect(pattern).toContain("kept conflicting with work");
    expect(pattern).toContain("Skipped");
  });

  it("says plainly when nothing happened, rather than fabricating a pattern", () => {
    expect(describeAmendmentPattern([])).toMatch(/no amendments/i);
  });
});

// ── §9 — cross-user denial on every id-addressed planning route ────────────

describe("cross-user denial (§9) — a plan or task id is not a capability", () => {
  it("acceptPlan denies a plan that belongs to another user", async () => {
    const plan = await insertPlan({
      userId: alice.id, horizon: "day", periodStart: startOfDay(new Date()),
      payload: { horizon: "day", date: dateKey(new Date()), items: [] },
    });
    await expect(
      acceptPlan({ userId: bob.id, email: bob.email }, plan.id),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("amendPlan denies a plan that belongs to another user", async () => {
    const plan = await insertPlan({
      userId: alice.id, horizon: "day", periodStart: startOfDay(new Date()),
      payload: {
        horizon: "day", date: dateKey(new Date()),
        items: [{ id: "x", title: "x", kind: "reading" }],
      },
    });
    await expect(
      amendPlan({ userId: bob.id, email: bob.email }, plan.id, [
        { itemId: "x", action: "removed" },
      ]),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("updateTask denies a task that belongs to another user", async () => {
    const [task] = await db.insert(tasks).values({
      userId: alice.id, title: "alice's task", source: "student",
    }).returning();

    await expect(
      updateTask({ userId: bob.id, email: bob.email }, task!.id, { status: "done" }),
    ).rejects.toMatchObject({ status: 404 });

    await db.delete(tasks).where(eq(tasks.id, task!.id));
  });

  it("createTask denies attaching to another user's course", async () => {
    await expect(
      createTask({ userId: bob.id, email: bob.email }, { title: "sneaky", courseId: course.id }),
    ).rejects.toBeInstanceOf(AuthzError);
  });
});

// ── §5 — an unanswered proposal persists until the student answers it ──────

describe("plan_week_propose — an unanswered proposal is not clobbered on re-run", () => {
  it("leaves a pending proposal alone rather than regenerating over it", async () => {
    const weekStart = dateKey(mondayOf(startOfDay(new Date())));

    // A clean slate for this exact period — this test's assertion is about
    // count, so any unrelated week-plan fixture already sitting on alice's
    // current week (from a prior run, or another describe block) would
    // otherwise pass or fail this test by accident.
    await db.delete(plans).where(and(
      eq(plans.userId, alice.id), eq(plans.horizon, "week"), eq(plans.periodStart, mondayOf(startOfDay(new Date()))),
    ));

    const original = await insertPlan({
      userId: alice.id, horizon: "week", periodStart: mondayOf(startOfDay(new Date())),
      status: "proposed",
      payload: {
        horizon: "week", weekStart, summary: "original proposal — untouched", focus: [], days: [], risks: [],
      },
    });

    // Same job the cadence enqueues on every app open — this run must be a
    // no-op given a pending proposal already sitting there unanswered.
    await proposeWeekHandler.handle({
      id: "test-job", userId: alice.id, kind: "plan_week_propose",
      payload: { weekStart }, attempts: 0,
    });

    const row = await getCurrentPlanRow(alice.id, "week", weekStart);
    expect(row?.id).toBe(original.id);
    expect((row?.payload as { summary?: string })?.summary).toBe("original proposal — untouched");

    const all = await db.select().from(plans).where(and(
      eq(plans.userId, alice.id), eq(plans.horizon, "week"), eq(plans.periodStart, mondayOf(startOfDay(new Date()))),
    ));
    expect(all).toHaveLength(1);
  });
});
