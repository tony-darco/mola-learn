"use client";

import { useState } from "react";
import type { SemesterPlanPayload } from "@mola/shared";
import {
  daysUntil, describeWhen, milestoneRemoveAmendment, milestoneRescheduleAmendment, parseDay, shortDate,
  type PlanAmendment,
} from "./plan-logic";
import { badge, ghostButton, input, primaryButton, secondaryButton } from "./styles";

type Milestone = SemesterPlanPayload["milestones"][number];

const MILESTONE_LABEL: Record<Milestone["kind"], string> = {
  exam: "Exam", project: "Project", unit: "Unit", checkpoint: "Checkpoint",
};

/**
 * The semester: what the student is aiming at, and the dates that shape it.
 * When the plan was re-proposed by the end-of-week review the review block
 * leads — it is the reason the rest of this changed, and a milestone list
 * that moved for unstated reasons is just an unexplained diff.
 */
export function SemesterPlan({
  payload, now, courseLabel, onAmend, busy = false,
}: {
  payload: SemesterPlanPayload;
  now: Date;
  courseLabel: (courseId: string | null | undefined) => string | null;
  onAmend?: (amendments: PlanAmendment[]) => Promise<void>;
  busy?: boolean;
}) {
  const milestones = [...payload.milestones].sort((a, b) => a.targetDate.localeCompare(b.targetDate));
  const nextIndex = milestones.findIndex((m) => daysUntil(m.targetDate, now) >= 0);

  return (
    <div className="flex flex-col gap-3">
      {payload.review && <ReviewBlock review={payload.review} now={now} />}

      {payload.summary && <p className="m-0 text-sm text-fg">{payload.summary}</p>}

      {payload.goals.length > 0 && (
        <div data-testid="semester-goals">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-muted">Goals</div>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {payload.goals.map((goal, i) => (
              <li key={i} className="text-sm text-fg">
                {courseLabel(goal.courseId) && (
                  <span className="mr-2 text-fg-muted">{courseLabel(goal.courseId)}</span>
                )}
                {goal.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {milestones.length > 0 && (
        <div data-testid="semester-milestones">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">Milestones</div>
          <ol className="relative m-0 flex list-none flex-col gap-2.5 p-0 pl-5">
            <span className="absolute bottom-2 left-[3px] top-2 w-px bg-border" aria-hidden="true" />
            {milestones.map((milestone, i) => (
              <MilestoneRow
                key={`${milestone.title}-${milestone.targetDate}`}
                milestone={milestone}
                now={now}
                next={i === nextIndex}
                courseLabel={courseLabel}
                onAmend={onAmend}
                busy={busy}
              />
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

/**
 * The loop closing (§5). The review reads the *pattern* of amendments the
 * student made last week, so it is presented as an observation about how the
 * week actually went followed by what that would change — not as a diff.
 */
function ReviewBlock({
  review, now,
}: { review: NonNullable<SemesterPlanPayload["review"]>; now: Date }) {
  return (
    <div className="rounded-lg border border-accent/40 bg-accent/5 p-3" data-testid="plan-review">
      <div className="text-sm font-semibold text-fg">
        Looking back at the week of {shortDate(review.basedOnWeekStart)}
      </div>
      <div className="mt-0.5 text-xs text-fg-muted">
        Reviewed {describeWhen(review.basedOnWeekStart, now)} — based on the changes you made to that week.
      </div>

      {review.observations.length > 0 && (
        <>
          <div className="mt-3 text-xs font-medium uppercase tracking-wide text-fg-muted">What last week looked like</div>
          <ul className="m-0 mt-1 flex list-disc flex-col gap-1 pl-5">
            {review.observations.map((observation, i) => (
              <li key={i} className="text-sm text-fg">{observation}</li>
            ))}
          </ul>
        </>
      )}

      {review.proposedChanges.length > 0 && (
        <>
          <div className="mt-3 text-xs font-medium uppercase tracking-wide text-fg-muted">What this would change</div>
          <ul className="m-0 mt-1 flex list-disc flex-col gap-1 pl-5">
            {review.proposedChanges.map((change, i) => (
              <li key={i} className="text-sm text-fg">{change}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function MilestoneRow({
  milestone, now, next, courseLabel, onAmend, busy,
}: {
  milestone: Milestone;
  now: Date;
  /** The nearest one still ahead — the only dot worth filling in. */
  next: boolean;
  courseLabel: (courseId: string | null | undefined) => string | null;
  onAmend?: (amendments: PlanAmendment[]) => Promise<void>;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [targetDate, setTargetDate] = useState(milestone.targetDate);
  const [reason, setReason] = useState("");

  const days = daysUntil(milestone.targetDate, now);
  const past = days < 0;
  const course = courseLabel(milestone.courseId);

  function reset() {
    setTargetDate(milestone.targetDate);
    setReason("");
    setOpen(false);
  }

  return (
    <li className="relative" data-testid="semester-milestone">
      <span
        className={`absolute -left-5 top-1.5 h-[7px] w-[7px] rounded-full border ${
          next ? "border-accent bg-accent" : past ? "border-border bg-border" : "border-border bg-surface"
        }`}
        aria-hidden="true"
      />
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`text-sm ${past ? "text-fg-muted" : "text-fg"}`}>{milestone.title}</span>
            <span className={badge}>{MILESTONE_LABEL[milestone.kind]}</span>
          </div>
          <div className="text-xs text-fg-muted">
            {parseDay(milestone.targetDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            {" · "}{describeWhen(milestone.targetDate, now)}
            {course ? ` · ${course}` : ""}
          </div>
        </div>
        {onAmend && (
          <button
            type="button"
            className={ghostButton}
            onClick={() => (open ? reset() : setOpen(true))}
            disabled={busy}
            aria-expanded={open}
            data-testid="milestone-adjust"
          >
            {open ? "Cancel" : "Adjust"}
          </button>
        )}
      </div>

      {open && onAmend && (
        <div className="mt-2 flex flex-col gap-2 rounded-lg border border-border bg-bg p-2.5">
          <label className="flex items-center gap-1.5 text-xs text-fg-muted">
            Target date
            <input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className={input}
              data-testid="milestone-date"
            />
          </label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why the change? (optional)"
            className={input}
            data-testid="milestone-reason"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={primaryButton}
              disabled={busy}
              data-testid="milestone-apply"
              onClick={() => {
                if (targetDate && targetDate !== milestone.targetDate) {
                  void onAmend([milestoneRescheduleAmendment(milestone, targetDate, reason)]).then(reset);
                } else {
                  reset();
                }
              }}
            >
              Apply
            </button>
            <button
              type="button"
              className={secondaryButton}
              disabled={busy}
              data-testid="milestone-remove"
              onClick={() => void onAmend([milestoneRemoveAmendment(milestone, reason)]).then(reset)}
            >
              Drop it
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
