/**
 * What the planning loop owes the student today, and nothing more.
 *
 * §5's cadence is written for a world where a scheduler fires on Sunday. This
 * is the other half of that sentence — "if the app isn't opened Sunday, the
 * proposal persists and is presented on next open, whatever day that is". So
 * the question this file answers is not "what day is it" but "what is missing":
 * a week with no proposal gets one whenever the student turns up, a Thursday
 * open still produces Thursday's plan, and a week that ended without ever
 * being reviewed is reviewed late rather than not at all.
 *
 * Enqueue only. Nothing here generates, approves or decides anything — it puts
 * work on the queue that `runDueJobs()` drains, and every one of those jobs
 * still stops at the propose gate.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, plans } from "@mola/db";
import type { CalendarJobKind } from "@mola/shared";
import { enqueueJob } from "@/lib/jobs/worker";
import { addDays, dateKey, mondayOf, startOfDay } from "./dates";
import { getApprovedPlanRow, getCurrentPlanRow } from "./lifecycle";
import { gatherWeekAmendments } from "./review";

/**
 * Enqueues whatever the cadence is missing, and returns what it queued so a
 * caller can log it. Safe to call on every app open: `enqueueJob` skips a kind
 * that is already pending, and each handler re-checks its own preconditions
 * before spending a generation.
 */
export async function ensurePlansForToday(userId: string): Promise<CalendarJobKind[]> {
  const today = startOfDay(new Date());
  const thisMonday = mondayOf(today);
  const thisWeek = dateKey(thisMonday);
  const queued: CalendarJobKind[] = [];

  const enqueue = async (kind: CalendarJobKind, payload: Record<string, unknown>) => {
    await enqueueJob(userId, kind, payload);
    queued.push(kind);
  };

  // 1. The week under way. A missing proposal here is the common case on a
  //    Monday-morning first open, and it blocks everything below it.
  if (!(await getCurrentPlanRow(userId, "week", thisWeek))) {
    await enqueue("plan_week_propose", { weekStart: thisWeek });
  }

  // 2. Sunday, planning forward. §5's weekly agent, in the one place it can
  //    still run on time.
  if (today.getDay() === 0) {
    const nextWeek = dateKey(addDays(thisMonday, 7));
    if (!(await getCurrentPlanRow(userId, "week", nextWeek))) {
      await enqueue("plan_week_propose", { weekStart: nextWeek });
    }
  }

  // 3. Today's decomposition, but only once the week it comes from has actually
  //    been agreed to.
  const todayKey = dateKey(today);
  if (await getApprovedPlanRow(userId, "week", thisWeek)) {
    if (!(await getCurrentPlanRow(userId, "day", todayKey))) {
      await enqueue("plan_day_propose", { date: todayKey });
    }
  }

  // 4. The week that has ended. On Sunday that is the week closing today —
  //    running the review before the evening's re-proposal is the point of the
  //    loop; on any other day it is last week, caught up late.
  const reviewWeek = dateKey(today.getDay() === 0 ? thisMonday : addDays(thisMonday, -7));
  if (await reviewIsDue(userId, reviewWeek)) {
    await enqueue("plan_week_review", { weekStart: reviewWeek });
  }

  return queued;
}

/**
 * A review is worth running only when there is something to read and nobody
 * has read it yet. Re-proposing the semester off an empty log would churn an
 * approved plan for no reason the student could see.
 */
async function reviewIsDue(userId: string, weekStart: string): Promise<boolean> {
  if (!(await getApprovedPlanRow(userId, "week", weekStart))) return false;
  if (await weekAlreadyReviewed(userId, weekStart)) return false;
  return (await gatherWeekAmendments(userId, weekStart)).length > 0;
}

/**
 * The semester plan carries its own receipt: `review.basedOnWeekStart` names
 * the week that produced it. Superseded plans count — a review the student
 * rejected still happened, and running it again would just re-ask a question
 * they already answered.
 */
async function weekAlreadyReviewed(userId: string, weekStart: string): Promise<boolean> {
  const rows = await db.select({ payload: plans.payload }).from(plans).where(and(
    eq(plans.userId, userId),
    eq(plans.horizon, "semester"),
    inArray(plans.status, ["proposed", "approved", "amended", "superseded"]),
  ));

  return rows.some((row) => {
    const payload = row.payload as { review?: { basedOnWeekStart?: unknown } | null };
    return payload?.review?.basedOnWeekStart === weekStart;
  });
}
