"use client";

import { useState } from "react";
import type { DayPlanPayload } from "@mola/shared";
import { addDays, formatMinutes, localDayKey, parseDay, totalMinutes, type PlanAmendment } from "./plan-logic";
import { PlanItemRow } from "./PlanItemRow";
import { AddBlockForm } from "./WeekPlan";
import { ghostButton } from "./styles";

/**
 * A day proposal — what the Today section shows before it has been accepted.
 * Once accepted the same blocks come back as tasks (contract D materialises
 * them on accept), so this renderer is the *question*, and TodayTasks is the
 * answer. Moving a block off the day is still a reschedule against a `date`
 * bucket, so the week's day options are offered here too.
 */
export function DayPlan({
  payload, courseLabel, relatedLabel, onAmend, busy = false,
}: {
  payload: DayPlanPayload;
  courseLabel: (courseId: string | null | undefined) => string | null;
  relatedLabel: (scheduleItemId: string | null | undefined) => string | null;
  onAmend?: (amendments: PlanAmendment[]) => Promise<void>;
  busy?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const start = parseDay(payload.date);
  const dayOptions = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(start, i);
    return {
      value: localDayKey(date),
      label: date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }),
    };
  });
  const minutes = totalMinutes(payload.items);

  return (
    <div className="flex flex-col gap-2">
      {payload.summary && <p className="m-0 text-sm text-fg">{payload.summary}</p>}
      {minutes > 0 && <div className="text-xs text-fg-muted">{formatMinutes(minutes)} planned</div>}

      {payload.items.length === 0 && <p className="m-0 text-sm text-fg-muted">Nothing planned for today.</p>}
      {payload.items.map((item) => (
        <PlanItemRow
          key={item.id}
          item={item}
          date={payload.date}
          dayOptions={dayOptions}
          courseLabel={courseLabel}
          relatedLabel={relatedLabel(item.relatedScheduleItemId)}
          onAmend={onAmend}
          busy={busy}
        />
      ))}

      {onAmend && (adding ? (
        <AddBlockForm
          date={payload.date}
          busy={busy}
          onCancel={() => setAdding(false)}
          onAdd={async (amendment) => {
            await onAmend([amendment]);
            setAdding(false);
          }}
        />
      ) : (
        <button
          type="button"
          className={`${ghostButton} self-start`}
          onClick={() => setAdding(true)}
          disabled={busy}
          data-testid="day-plan-add"
        >
          + Add a block
        </button>
      ))}
    </div>
  );
}
