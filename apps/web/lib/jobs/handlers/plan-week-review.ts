/**
 * The end-of-week review (§5). Owned by Agent J3.
 *
 * This is the job the feedback loop is made of, and the one place the loop
 * could quietly break: "amendments to 2.1/2.2 are NOT silently applied to 2.3.
 * At end of week, a review step examines the pattern of amendments made and
 * re-proposes adjustments to the semester plan through the same
 * propose-and-approve gate."
 *
 * Every word of that survives here. The handler reads `plan_amendments` for
 * the week — the log, not a diff of overwritten payloads, because only the log
 * remembers that the same reading block was pushed four times — and hands the
 * pattern to the semester generator as evidence. What comes back is a
 * *proposal*. It does not touch the approved semester plan, which stays in
 * force, stays the parent of next week's plan, and is superseded only if and
 * when the student accepts the replacement.
 *
 * A week nobody amended teaches nothing, so it is not re-proposed at all —
 * churning an approved plan for no visible reason costs the student's trust in
 * every later proposal.
 */
import { addDays, dateKey, isDateKey, mondayOf, startOfDay } from "@/lib/planning/dates";
import { getApprovedPlanRow, proposePlan, sessionForUser } from "@/lib/planning/lifecycle";
import { describeAmendmentPattern, gatherWeekAmendments } from "@/lib/planning/review";
import { PermanentJobFailure, type JobHandler } from "../types";

export const weekReviewHandler: JobHandler = {
  kind: "plan_week_review",
  async handle(job) {
    const weekStart = weekUnderReview(job.payload.weekStart);

    // A week the student never agreed to is not evidence about how their week
    // went; it is evidence that they ignored a proposal.
    if (!(await getApprovedPlanRow(job.userId, "week", weekStart))) return;

    const amendments = await gatherWeekAmendments(job.userId, weekStart);
    if (amendments.length === 0) return;

    const session = await sessionForUser(job.userId);
    if (!session) throw new PermanentJobFailure(`no user ${job.userId}`);

    await proposePlan({
      session,
      horizon: "semester",
      review: { basedOnWeekStart: weekStart, pattern: describeAmendmentPattern(amendments) },
    });
  },
};

/** The week that has ended: the one closing today on a Sunday, last week otherwise. */
function weekUnderReview(value: unknown): string {
  if (isDateKey(value)) return value;
  const today = startOfDay(new Date());
  const monday = mondayOf(today);
  return dateKey(today.getDay() === 0 ? monday : addDays(monday, -7));
}
