"use client";

import { useState } from "react";
import Link from "next/link";
import type { PlannedItem, PlannedItemKind } from "@mola/shared";
import { formatMinutes, removeAmendment, rescheduleAmendment, resizeAmendment, type PlanAmendment } from "./plan-logic";
import { badge, ghostButton, input, primaryButton, secondaryButton } from "./styles";

const KIND_LABEL: Record<PlannedItemKind, string> = {
  study: "Study", homework: "Homework", review: "Review", reading: "Reading",
  practice_quiz: "Practice quiz", flashcards: "Flashcards", break: "Break",
};

/** A block whose kind names a surface the student already has goes there
 * rather than pretending to generate something new. */
const KIND_LINK: Partial<Record<PlannedItemKind, { href: string; label: string }>> = {
  practice_quiz: { href: "/quizzes", label: "Open quizzes" },
  flashcards: { href: "/flashcards", label: "Open flashcards" },
};

/**
 * One block of a plan, with the amend affordances folded away until asked
 * for. Move, resize and remove all go through the one `Apply` so a student
 * who shifts a block and shortens it in the same breath sends one amendment
 * batch with one reason attached, rather than two unexplained ones.
 */
export function PlanItemRow({
  item, date, dayOptions, courseLabel, relatedLabel, onAmend, busy = false,
}: {
  item: PlannedItem;
  /** The day bucket this block currently sits in — the `before` of a move. */
  date: string;
  dayOptions: { value: string; label: string }[];
  courseLabel: (courseId: string | null | undefined) => string | null;
  /** "for Quiz 3 · Thursday", when the block serves a deadline. */
  relatedLabel?: string | null;
  onAmend?: (amendments: PlanAmendment[]) => Promise<void>;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(date);
  const [minutes, setMinutes] = useState(item.estimatedMinutes ?? 0);
  const [reason, setReason] = useState("");

  const course = courseLabel(item.courseId);
  const link = KIND_LINK[item.kind];

  function reset() {
    setDay(date);
    setMinutes(item.estimatedMinutes ?? 0);
    setReason("");
    setOpen(false);
  }

  async function apply() {
    if (!onAmend) return;
    const amendments: PlanAmendment[] = [];
    if (day !== date) amendments.push(rescheduleAmendment(item, date, day, reason));
    if (minutes > 0 && minutes !== (item.estimatedMinutes ?? 0)) {
      amendments.push(resizeAmendment(item, minutes, reason));
    }
    if (amendments.length > 0) await onAmend(amendments);
    reset();
  }

  async function remove() {
    if (!onAmend) return;
    await onAmend([removeAmendment(item, date, reason)]);
    reset();
  }

  return (
    <div className="rounded-lg border border-border bg-bg px-3 py-2" data-testid="plan-item">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm text-fg">{item.title}</span>
            <span className={badge}>{KIND_LABEL[item.kind]}</span>
            {item.estimatedMinutes ? (
              <span className="text-xs text-fg-muted">{formatMinutes(item.estimatedMinutes)}</span>
            ) : null}
            {course && <span className="truncate text-xs text-fg-muted">{course}</span>}
          </div>
          {relatedLabel && <div className="mt-0.5 text-xs text-fg-muted">{relatedLabel}</div>}
          {item.rationale && <div className="mt-0.5 text-xs text-fg-muted">{item.rationale}</div>}
          {link && (
            <Link href={link.href} className="mt-0.5 inline-block text-xs no-underline hover:underline">
              {link.label}
            </Link>
          )}
        </div>
        {onAmend && (
          <button
            type="button"
            className={ghostButton}
            onClick={() => (open ? reset() : setOpen(true))}
            disabled={busy}
            data-testid="plan-item-adjust"
            aria-expanded={open}
          >
            {open ? "Cancel" : "Adjust"}
          </button>
        )}
      </div>

      {open && onAmend && (
        <div className="mt-2 flex flex-col gap-2 border-t border-border pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-fg-muted">
              Day
              <select
                value={day}
                onChange={(e) => setDay(e.target.value)}
                className={input}
                data-testid="plan-item-day"
              >
                {dayOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-fg-muted">
              Minutes
              <input
                type="number"
                min={5}
                step={5}
                value={minutes || ""}
                onChange={(e) => setMinutes(Number(e.target.value))}
                className={`${input} w-20`}
                data-testid="plan-item-minutes"
              />
            </label>
          </div>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why the change? (optional)"
            className={input}
            data-testid="plan-item-reason"
          />
          <div className="flex items-center gap-2">
            <button type="button" className={primaryButton} onClick={() => void apply()} disabled={busy} data-testid="plan-item-apply">
              Apply
            </button>
            <button type="button" className={secondaryButton} onClick={() => void remove()} disabled={busy} data-testid="plan-item-remove">
              Remove from plan
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
