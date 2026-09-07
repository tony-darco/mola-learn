"use client";

import { useState } from "react";
import type { PlannedItemKind, WeekPlanPayload } from "@mola/shared";
import { PLANNED_ITEM_KINDS } from "@mola/shared";
import {
  addAmendment, formatMinutes, localDayKey, parseDay, totalMinutes, weekDays, type PlanAmendment,
} from "./plan-logic";
import { PlanItemRow } from "./PlanItemRow";
import { ghostButton, input, primaryButton } from "./styles";

const KIND_LABEL: Record<PlannedItemKind, string> = {
  study: "Study", homework: "Homework", review: "Review", reading: "Reading",
  practice_quiz: "Practice quiz", flashcards: "Flashcards", break: "Break",
};

/**
 * The week payload, day by day. `risks` sits above everything the planner
 * proposed rather than at the bottom next to the fine print — two deadlines
 * landing on the same Thursday is the single most useful thing on this page,
 * and it is useless if the student has to scroll to it.
 */
export function WeekPlan({
  payload, now, courseLabel, relatedLabel, onAmend, busy = false,
}: {
  payload: WeekPlanPayload;
  now: Date;
  courseLabel: (courseId: string | null | undefined) => string | null;
  relatedLabel: (scheduleItemId: string | null | undefined) => string | null;
  onAmend?: (amendments: PlanAmendment[]) => Promise<void>;
  busy?: boolean;
}) {
  const days = weekDays(payload.weekStart, payload.days);
  const today = localDayKey(now);
  const dayOptions = days.map((d) => ({
    value: d.date,
    label: parseDay(d.date).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }),
  }));

  return (
    <div className="flex flex-col gap-3">
      {payload.summary && <p className="m-0 text-sm text-fg">{payload.summary}</p>}

      {payload.risks.length > 0 && (
        <div className="rounded-lg border border-accent/40 bg-accent/5 p-3" data-testid="week-risks">
          <div className="mb-1 text-sm font-semibold text-fg">Heads up</div>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
            {payload.risks.map((risk, i) => (
              <li key={i} className="text-sm text-fg">{risk}</li>
            ))}
          </ul>
        </div>
      )}

      {payload.focus.length > 0 && (
        <div data-testid="week-focus">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-muted">Focus</div>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {payload.focus.map((focus, i) => (
              <li key={i} className="flex gap-2 text-sm text-fg">
                <span className="w-28 shrink-0 truncate text-fg-muted">{courseLabel(focus.courseId) ?? "General"}</span>
                <span className="min-w-0 flex-1">{focus.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col">
        {days.map((day) => (
          <DayRow
            key={day.date}
            day={day}
            isToday={day.date === today}
            dayOptions={dayOptions}
            courseLabel={courseLabel}
            relatedLabel={relatedLabel}
            onAmend={onAmend}
            busy={busy}
          />
        ))}
      </div>
    </div>
  );
}

function DayRow({
  day, isToday, dayOptions, courseLabel, relatedLabel, onAmend, busy,
}: {
  day: { date: string; items: WeekPlanPayload["days"][number]["items"] };
  isToday: boolean;
  dayOptions: { value: string; label: string }[];
  courseLabel: (courseId: string | null | undefined) => string | null;
  relatedLabel: (scheduleItemId: string | null | undefined) => string | null;
  onAmend?: (amendments: PlanAmendment[]) => Promise<void>;
  busy: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const date = parseDay(day.date);
  const minutes = totalMinutes(day.items);

  return (
    <div
      className={`flex gap-3 rounded-lg border px-2.5 py-2 ${isToday ? "border-accent/40 bg-accent/5" : "border-transparent"}`}
      data-testid="week-day"
      data-date={day.date}
    >
      <div className="w-24 shrink-0">
        <div className="text-sm font-medium text-fg">{date.toLocaleDateString(undefined, { weekday: "short" })}</div>
        <div className="text-xs text-fg-muted">{date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</div>
        {minutes > 0 && <div className="text-xs text-fg-muted">{formatMinutes(minutes)}</div>}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {day.items.length === 0 && !adding && (
          <div className="py-1 text-sm text-fg-muted">Nothing planned</div>
        )}
        {day.items.map((item) => (
          <PlanItemRow
            key={item.id}
            item={item}
            date={day.date}
            dayOptions={dayOptions}
            courseLabel={courseLabel}
            relatedLabel={relatedLabel(item.relatedScheduleItemId)}
            onAmend={onAmend}
            busy={busy}
          />
        ))}

        {onAmend && (adding ? (
          <AddBlockForm
            date={day.date}
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
            data-testid="week-day-add"
          >
            + Add a block
          </button>
        ))}
      </div>
    </div>
  );
}

/** Shared with the day plan, which is the same gate over one bucket. */
export function AddBlockForm({
  date, busy, onAdd, onCancel,
}: {
  date: string;
  busy: boolean;
  onAdd: (amendment: PlanAmendment) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<PlannedItemKind>("study");
  const [minutes, setMinutes] = useState(30);
  const [reason, setReason] = useState("");

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed) return;
    await onAdd(addAmendment(
      { id: crypto.randomUUID(), title: trimmed, kind, estimatedMinutes: minutes || null },
      date,
      reason,
    ));
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-bg px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={title}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submit(); } }}
          placeholder="What are you adding?"
          className={`${input} min-w-[180px] flex-1`}
          data-testid="add-block-title"
        />
        <select value={kind} onChange={(e) => setKind(e.target.value as PlannedItemKind)} className={input} data-testid="add-block-kind">
          {PLANNED_ITEM_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
        <input
          type="number"
          min={5}
          step={5}
          value={minutes || ""}
          onChange={(e) => setMinutes(Number(e.target.value))}
          className={`${input} w-20`}
          aria-label="Estimated minutes"
          data-testid="add-block-minutes"
        />
      </div>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why are you adding it? (optional)"
        className={input}
        data-testid="add-block-reason"
      />
      <div className="flex items-center gap-2">
        <button type="button" className={primaryButton} onClick={() => void submit()} disabled={busy} data-testid="add-block-submit">
          Add
        </button>
        <button type="button" className={ghostButton} onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}
