/**
 * Daily decomposition (§5). Owned by Agent J3.
 *
 * "Once approved, the week decomposes into daily plans" — approved is the
 * operative word, and it is why this handler can decline to do anything. A day
 * plan built from a week the student is still deciding about would quietly put
 * that week into force: they would find themselves working a plan they never
 * accepted, one Tuesday at a time.
 *
 * So when the week is not agreed yet, the job succeeds having done nothing.
 * `ensurePlansForToday` re-enqueues it on the next open, and by then the week
 * may well have been accepted.
 */
import { dateKey, isDateKey, mondayOf, parseDateKey, startOfDay } from "@/lib/planning/dates";
import {
  getApprovedPlanRow, getCurrentPlanRow, proposePlan, sessionForUser,
} from "@/lib/planning/lifecycle";
import { PermanentJobFailure, type JobHandler } from "../types";

export const proposeDayHandler: JobHandler = {
  kind: "plan_day_propose",
  async handle(job) {
    const date = isDateKey(job.payload.date) ? job.payload.date : dateKey(startOfDay(new Date()));

    if (await getCurrentPlanRow(job.userId, "day", date)) return;

    const weekStart = dateKey(mondayOf(parseDateKey(date)));
    if (!(await getApprovedPlanRow(job.userId, "week", weekStart))) return;

    const session = await sessionForUser(job.userId);
    if (!session) throw new PermanentJobFailure(`no user ${job.userId}`);

    await proposePlan({ session, horizon: "day", date });
  },
};
