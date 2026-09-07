/**
 * The Sunday planner (§5). Owned by Agent J3.
 *
 * The rule that shapes this handler is the one about persistence: "if the app
 * isn't opened Sunday, the proposal persists and is presented on next open."
 * Two consequences, and between them they are the whole body.
 *
 * It never approves. The plan lands as `proposed` and waits, however long that
 * takes — a plan the student has not seen is not a plan they agreed to.
 *
 * And it never regenerates over a proposal they have not answered. This job is
 * enqueued on every app open, so a handler that rewrote Sunday's proposal each
 * time would keep replacing the thing the student was still deciding about,
 * for exactly as long as they hesitated. An explicit re-propose is a different
 * act, and it comes through POST /api/plan/propose instead.
 */
import { addDays, dateKey, isDateKey, mondayOf, startOfDay } from "@/lib/planning/dates";
import { getCurrentPlanRow, proposePlan, sessionForUser } from "@/lib/planning/lifecycle";
import { PermanentJobFailure, type JobHandler } from "../types";

export const proposeWeekHandler: JobHandler = {
  kind: "plan_week_propose",
  async handle(job) {
    const weekStart = weekStartOf(job.payload.weekStart);

    // Proposed, approved or amended — all three mean the student has a week
    // plan in hand and this job has nothing left to do.
    if (await getCurrentPlanRow(job.userId, "week", weekStart)) return;

    const session = await sessionForUser(job.userId);
    if (!session) throw new PermanentJobFailure(`no user ${job.userId}`);

    await proposePlan({ session, horizon: "week", date: weekStart });
  },
};

/**
 * A Sunday run plans the week about to start, not the one closing around it —
 * `mondayOf` counts Sunday as the last day of the week it ends.
 */
function weekStartOf(value: unknown): string {
  if (isDateKey(value)) return value;
  const today = startOfDay(new Date());
  const monday = mondayOf(today);
  return dateKey(today.getDay() === 0 ? addDays(monday, 7) : monday);
}
