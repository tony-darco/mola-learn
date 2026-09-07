/**
 * The propose → amend → accept state machine (§5), and the tasks the accepted
 * plan turns into.
 *
 * The gate is the product. Nothing here approves a plan on the student's
 * behalf, nothing regenerates over a proposal they have not answered, and
 * nothing lets an amendment to today leak upward into the semester plan — that
 * last one only ever happens through `plan_week_review`, which re-proposes the
 * semester through this same gate.
 *
 * Every function takes an explicit `Session` and goes through `requireOwned`
 * (contract 2). The routes are thin wrappers; the checks live here so the
 * ownership tests exercise the same code the routes do.
 */
import { and, asc, desc, eq, gte, isNull, lte, ne, or, sql } from "drizzle-orm";
import {
  courses, db, planAmendments, plans, scheduleItems, tasks,
} from "@mola/db";
import type { PlanPayload, TaskView } from "@mola/shared";
import { planPayloadSchema } from "@mola/shared";
import { requireOwned, type Session } from "@/lib/auth/ownership";
import {
  addDays, dateKey, endOfDay, mondayOf, parseDateKey, startOfDay,
} from "./dates";
import {
  generateDayPlan, generateSemesterPlan, generateWeekPlan, type PlanCompleter,
} from "./generate";
import { applyAmendment, findItem, itemsOfPayload, type AmendmentInput } from "./payload";

export type PlanHorizon = "day" | "week" | "semester";

/** Contract D's read model, byte for byte. */
export type PlanRecord = {
  id: string;
  horizon: PlanHorizon;
  periodStart: string;
  periodEnd: string | null;
  status: "proposed" | "approved" | "amended" | "superseded";
  payload: PlanPayload;
  approvedAt: string | null;
  parentPlanId: string | null;
};

type PlanRow = typeof plans.$inferSelect;

export function toPlanRecord(row: PlanRow): PlanRecord {
  return {
    id: row.id,
    horizon: row.horizon,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd?.toISOString() ?? null,
    status: row.status,
    payload: planPayloadSchema.parse(row.payload),
    approvedAt: row.approvedAt?.toISOString() ?? null,
    parentPlanId: row.parentPlanId,
  };
}

// ── Reading ──────────────────────────────────────────────────────────────────

/**
 * The plan in force for that horizon and date — proposed or approved. A
 * superseded plan is history and never comes back out of here.
 *
 * Semester plans are looked up by recency rather than by period: a semester's
 * real start and end are rarely on file (terms.startDate is nullable and the
 * seed leaves it null), so "the current one" is the only definition that does
 * not quietly return nothing.
 */
export async function getCurrentPlanRow(
  userId: string,
  horizon: PlanHorizon,
  date?: string | null,
): Promise<PlanRow | null> {
  const conditions = [
    eq(plans.userId, userId),
    eq(plans.horizon, horizon),
    ne(plans.status, "superseded"),
  ];
  if (horizon !== "semester") {
    conditions.push(eq(plans.periodStart, periodOf(horizon, date).start));
  }

  const [row] = await db.select().from(plans)
    .where(and(...conditions))
    .orderBy(desc(plans.periodStart), desc(plans.createdAt))
    .limit(1);
  return row ?? null;
}

export async function getCurrentPlan(
  session: Session,
  horizon: PlanHorizon,
  date?: string | null,
): Promise<PlanRecord | null> {
  const row = await getCurrentPlanRow(session.userId, horizon, date);
  return row ? toPlanRecord(row) : null;
}

export function periodOf(horizon: PlanHorizon, date?: string | null): { start: Date; end: Date } {
  const anchor = date ? parseDateKey(date) : startOfDay(new Date());
  if (horizon === "day") return { start: startOfDay(anchor), end: endOfDay(anchor) };
  const monday = mondayOf(anchor);
  return { start: monday, end: endOfDay(addDays(monday, 6)) };
}

/**
 * The semester window. Term dates when the student set them; otherwise today
 * through the last thing on the calendar, floored at eight weeks so a sparse
 * calendar still gets a horizon worth planning against.
 */
export async function semesterPeriod(userId: string): Promise<{ start: Date; end: Date }> {
  const [latest] = await db
    .select({ when: sql<Date | null>`max(coalesce(${scheduleItems.startAt}, ${scheduleItems.dueAt}))` })
    .from(scheduleItems).where(eq(scheduleItems.userId, userId));

  const start = startOfDay(new Date());
  const floor = addDays(start, 8 * 7);
  const last = latest?.when ? new Date(latest.when) : null;
  return { start, end: last && last > floor ? endOfDay(last) : floor };
}

// ── Proposing ────────────────────────────────────────────────────────────────

export type ProposeArgs = {
  session: Session;
  horizon: PlanHorizon;
  date?: string | null;
  /** Injected by the end-of-week review; absent for a plain re-propose. */
  review?: { basedOnWeekStart: string; pattern: string };
  complete?: PlanCompleter;
};

export async function proposePlan(args: ProposeArgs): Promise<PlanRecord> {
  const { session, horizon } = args;
  const userId = session.userId;

  const period = horizon === "semester"
    ? await semesterPeriod(userId)
    : periodOf(horizon, args.date);

  const parent = await parentPlanRow(userId, horizon, args.date);
  const payload = await generateFor(args, period, parent);

  const existing = await getCurrentPlanRow(userId, horizon, args.date);

  // An unanswered proposal is edited in place: it keeps its id, so a link J4
  // already handed the student does not rot on regeneration. Anything the
  // student HAS answered — approved or amended — is superseded instead, so
  // the decision they made stays on the record next to what replaced it.
  if (existing && existing.status === "proposed") {
    const [row] = await db.update(plans).set({
      payload, periodEnd: period.end, parentPlanId: parent?.id ?? null, updatedAt: new Date(),
    }).where(eq(plans.id, existing.id)).returning();
    return toPlanRecord(row!);
  }

  const [row] = await db.insert(plans).values({
    userId,
    horizon,
    periodStart: period.start,
    periodEnd: period.end,
    status: "proposed",
    payload,
    parentPlanId: parent?.id ?? null,
  }).returning();

  if (existing) {
    await db.update(plans)
      .set({ status: "superseded", supersededByPlanId: row!.id, updatedAt: new Date() })
      .where(eq(plans.id, existing.id));
  }

  return toPlanRecord(row!);
}

async function generateFor(
  args: ProposeArgs,
  period: { start: Date; end: Date },
  parent: PlanRow | null,
): Promise<PlanPayload> {
  const userId = args.session.userId;
  if (args.horizon === "semester") {
    return generateSemesterPlan(
      { userId, from: period.start, to: period.end, review: args.review }, args.complete,
    );
  }
  if (args.horizon === "week") {
    return generateWeekPlan(
      { userId, weekStart: dateKey(period.start), semesterPlan: parent }, args.complete,
    );
  }
  return generateDayPlan(
    { userId, date: dateKey(period.start), weekPlan: parent }, args.complete,
  );
}

/** A day's parent is its week; a week's is the semester (§5's decomposition). */
async function parentPlanRow(
  userId: string,
  horizon: PlanHorizon,
  date?: string | null,
): Promise<PlanRow | null> {
  if (horizon === "semester") return null;
  if (horizon === "week") return getCurrentPlanRow(userId, "semester");
  return getCurrentPlanRow(userId, "week", date);
}

// ── Accepting ────────────────────────────────────────────────────────────────

export async function acceptPlan(session: Session, planId: string): Promise<PlanRecord> {
  const plan = await requireOwned("plan", planId, session);

  const [row] = await db.update(plans)
    .set({ status: "approved", approvedAt: new Date(), updatedAt: new Date() })
    .where(eq(plans.id, plan.id))
    .returning();

  await materialiseTasks(row!);

  // Approving a plan retires whatever it replaces at the same horizon and
  // period — including, for a semester plan re-proposed by the review, the
  // one the student was working to until now.
  await db.update(plans)
    .set({ status: "superseded", supersededByPlanId: row!.id, updatedAt: new Date() })
    .where(and(
      eq(plans.userId, session.userId),
      eq(plans.horizon, row!.horizon),
      ne(plans.id, row!.id),
      ne(plans.status, "superseded"),
      row!.horizon === "semester" ? sql`true` : eq(plans.periodStart, row!.periodStart),
    ));

  return toPlanRecord(row!);
}

/**
 * Payload items → `tasks` rows, idempotent on `(planId, planItemId)`.
 *
 * `status` and `completedAt` are deliberately absent from the conflict update:
 * re-accepting a plan, or accepting one that was amended after work had
 * already started, must never un-tick something the student finished.
 */
export async function materialiseTasks(plan: PlanRow): Promise<number> {
  const payload = planPayloadSchema.parse(plan.payload);
  const entries = itemsOfPayload(payload);
  if (entries.length === 0) return 0;

  await db.insert(tasks).values(entries.map(({ date, item }) => ({
    userId: plan.userId,
    courseId: item.courseId ?? null,
    planId: plan.id,
    planItemId: item.id,
    scheduleItemId: item.relatedScheduleItemId ?? null,
    title: item.title,
    notes: item.rationale ?? null,
    source: "plan" as const,
    scheduledFor: scheduledForOf(item.startAt ?? null, date),
    estimatedMinutes: item.estimatedMinutes ?? null,
  }))).onConflictDoUpdate({
    target: [tasks.planId, tasks.planItemId],
    set: {
      title: sql`excluded.title`,
      notes: sql`excluded.notes`,
      courseId: sql`excluded.course_id`,
      scheduleItemId: sql`excluded.schedule_item_id`,
      scheduledFor: sql`excluded.scheduled_for`,
      estimatedMinutes: sql`excluded.estimated_minutes`,
      updatedAt: new Date(),
    },
  });

  return entries.length;
}

function scheduledForOf(startAt: string | null, date: string | null): Date | null {
  if (startAt) {
    const at = new Date(startAt);
    if (!Number.isNaN(at.getTime())) return at;
  }
  return date ? parseDateKey(date) : null;
}

// ── Amending ─────────────────────────────────────────────────────────────────

/**
 * Writes the amendment log AND applies the change to the payload, in one
 * transaction — a log entry with no matching edit, or an edit the review can
 * never see, are both worse than failing.
 */
export async function amendPlan(
  session: Session,
  planId: string,
  amendments: AmendmentInput[],
): Promise<PlanRecord> {
  const plan = await requireOwned("plan", planId, session);
  if (amendments.length === 0) return toPlanRecord(plan);

  let payload = planPayloadSchema.parse(plan.payload);
  const log: (typeof planAmendments.$inferInsert)[] = [];

  for (const amendment of amendments) {
    // Snapshot before applying, so the review can compare the two ends of a
    // reschedule without the caller having had to send `before` itself.
    const before = amendment.before
      ?? (amendment.itemId ? findItem(payload, amendment.itemId) : null);
    payload = applyAmendment(payload, amendment);
    log.push({
      userId: session.userId,
      planId: plan.id,
      itemId: amendment.itemId ?? null,
      action: amendment.action,
      before: before ?? null,
      after: amendment.after ?? null,
      reason: amendment.reason ?? null,
    });
  }

  const [row] = await db.transaction(async (tx) => {
    await tx.insert(planAmendments).values(log);
    return tx.update(plans)
      .set({ payload, status: "amended", updatedAt: new Date() })
      .where(eq(plans.id, plan.id))
      .returning();
  });

  // A plan the student already accepted has tasks hanging off it; leaving them
  // pointing at the pre-amendment shape would make the task list disagree with
  // the plan it came from.
  if (row!.approvedAt) await resyncTasks(row!);

  return toPlanRecord(row!);
}

/** Upsert what the amended payload now holds; retire untouched tasks it dropped. */
async function resyncTasks(plan: PlanRow): Promise<void> {
  await materialiseTasks(plan);
  const live = itemsOfPayload(planPayloadSchema.parse(plan.payload)).map((e) => e.item.id);

  // Only `todo` rows are removed — a task the student already completed or
  // skipped is a record of what happened, not a line in the plan.
  await db.delete(tasks).where(and(
    eq(tasks.planId, plan.id),
    eq(tasks.status, "todo"),
    live.length > 0
      ? sql`${tasks.planItemId} is null or ${tasks.planItemId} <> all(${sql.param(live)}::text[])`
      : sql`true`,
  ));
}

// ── Tasks ────────────────────────────────────────────────────────────────────

export type TaskFilters = { date?: string | null; status?: TaskView["status"] | null; courseId?: string | null };

export async function listTasks(session: Session, filters: TaskFilters = {}): Promise<TaskView[]> {
  const conditions = [eq(tasks.userId, session.userId)];
  if (filters.status) conditions.push(eq(tasks.status, filters.status));
  if (filters.courseId) conditions.push(eq(tasks.courseId, filters.courseId));
  if (filters.date) {
    const day = parseDateKey(filters.date);
    // An undated task is still today's business — it has to be somewhere, and
    // hiding it behind a date filter is how a task list silently loses rows.
    conditions.push(or(
      and(gte(tasks.scheduledFor, day), lte(tasks.scheduledFor, endOfDay(day))),
      isNull(tasks.scheduledFor),
    )!);
  }

  const rows = await db.select({ task: tasks, courseName: courses.name })
    .from(tasks)
    .leftJoin(courses, eq(courses.id, tasks.courseId))
    .where(and(...conditions))
    .orderBy(asc(tasks.scheduledFor), asc(tasks.createdAt));

  return rows.map((r) => toTaskView(r.task, r.courseName));
}

export async function createTask(
  session: Session,
  body: {
    title: string; courseId?: string | null; scheduledFor?: string | null;
    estimatedMinutes?: number | null; notes?: string | null; scheduleItemId?: string | null;
  },
): Promise<TaskView> {
  const title = body.title?.trim();
  if (!title) throw new TaskInputError("title is required");
  if (body.courseId) await requireOwned("course", body.courseId, session);

  const [row] = await db.insert(tasks).values({
    userId: session.userId,
    courseId: body.courseId ?? null,
    scheduleItemId: body.scheduleItemId ?? null,
    title,
    notes: body.notes ?? null,
    source: "student",
    scheduledFor: body.scheduledFor ? new Date(body.scheduledFor) : null,
    estimatedMinutes: body.estimatedMinutes ?? null,
  }).returning();

  return toTaskView(row!, await courseNameOf(row!.courseId));
}

export type TaskPatch = {
  status?: TaskView["status"];
  title?: string;
  notes?: string | null;
  scheduledFor?: string | null;
  estimatedMinutes?: number | null;
};

/**
 * Check-off. `completedAt` is stamped server-side — a client-supplied
 * completion time is a client-supplied fact about when work happened.
 *
 * A task that came from a plan also writes its own amendment, which is what
 * makes "this kept getting skipped" visible to the end-of-week review without
 * the student ever opening the plan editor.
 */
export async function updateTask(
  session: Session,
  taskId: string,
  patch: TaskPatch,
): Promise<TaskView> {
  const task = await requireOwned("task", taskId, session);

  const update: Partial<typeof tasks.$inferInsert> = { updatedAt: new Date() };
  if (patch.title !== undefined) update.title = patch.title.trim() || task.title;
  if (patch.notes !== undefined) update.notes = patch.notes;
  if (patch.scheduledFor !== undefined) {
    update.scheduledFor = patch.scheduledFor ? new Date(patch.scheduledFor) : null;
  }
  if (patch.estimatedMinutes !== undefined) update.estimatedMinutes = patch.estimatedMinutes;
  if (patch.status !== undefined) {
    update.status = patch.status;
    update.completedAt = patch.status === "done" ? new Date() : null;
  }

  const [row] = await db.update(tasks).set(update).where(eq(tasks.id, task.id)).returning();

  const changedTo = patch.status;
  const isNewState = changedTo !== undefined && changedTo !== task.status;
  if (isNewState && (changedTo === "done" || changedTo === "skipped") && task.planId && task.planItemId) {
    await db.insert(planAmendments).values({
      userId: session.userId,
      planId: task.planId,
      itemId: task.planItemId,
      action: changedTo === "done" ? "completed" : "skipped",
      before: { status: task.status, estimatedMinutes: task.estimatedMinutes, title: task.title },
      after: { status: changedTo, completedAt: row!.completedAt?.toISOString() ?? null },
      reason: null,
    });
  }

  return toTaskView(row!, await courseNameOf(row!.courseId));
}

export class TaskInputError extends Error {}

function toTaskView(row: typeof tasks.$inferSelect, courseName: string | null): TaskView {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    status: row.status,
    source: row.source,
    courseId: row.courseId,
    courseName,
    scheduledFor: row.scheduledFor?.toISOString() ?? null,
    estimatedMinutes: row.estimatedMinutes,
    completedAt: row.completedAt?.toISOString() ?? null,
    scheduleItemId: row.scheduleItemId,
  };
}

async function courseNameOf(courseId: string | null): Promise<string | null> {
  if (!courseId) return null;
  const [row] = await db.select({ name: courses.name }).from(courses)
    .where(eq(courses.id, courseId)).limit(1);
  return row?.name ?? null;
}
