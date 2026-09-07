"use client";

import type { CalendarEvent } from "@mola/shared";
import { formatTimeRange, isCheckable, kindStyle, sourceLabel } from "./event-style";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">{label}</div>
      <div className="text-sm text-fg">{children}</div>
    </div>
  );
}

export function EventDetail({
  event, courseLabel, busy, error, onClose, onToggleComplete,
}: {
  event: CalendarEvent;
  courseLabel: string | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onToggleComplete: (ev: CalendarEvent) => void;
}) {
  const style = kindStyle(event.kind);
  const day = new Date(event.start).toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });

  return (
    <aside
      className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-border bg-surface p-4"
      data-testid="event-detail"
    >
      <div className="flex items-start justify-between gap-2">
        <span className={`rounded border px-1.5 py-0.5 text-xs font-medium ${style.chip}`}>{style.label}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close event details"
          data-testid="event-detail-close"
          className="-mt-1 rounded-md px-1.5 py-0.5 text-fg-muted hover:bg-bg hover:text-fg"
        >
          ×
        </button>
      </div>

      <h2 className="text-base font-semibold leading-snug text-fg">{event.title}</h2>

      <Row label="When">
        <div>{day}</div>
        <div className="text-fg-muted">{formatTimeRange(event)}</div>
      </Row>

      {courseLabel && <Row label="Course">{courseLabel}</Row>}
      {event.location && <Row label="Location">{event.location}</Row>}
      {event.description && (
        <Row label="Details">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">{event.description}</p>
        </Row>
      )}
      <Row label="Source">{sourceLabel(event.source)}</Row>

      {isCheckable(event) && (
        <div className="mt-auto border-t border-border pt-3">
          <button
            type="button"
            data-testid="event-complete-toggle"
            disabled={busy}
            onClick={() => onToggleComplete(event)}
            className={`w-full rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-60 ${
              event.completedAt
                ? "border border-border bg-bg text-fg"
                : "bg-accent text-accent-fg"
            }`}
          >
            {event.completedAt ? "Mark as not done" : "Mark as done"}
          </button>
          {event.completedAt && (
            <p className="mt-2 text-xs text-fg-muted">
              Completed {new Date(event.completedAt).toLocaleString(undefined, {
                month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
              })}
            </p>
          )}
          {error && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400" data-testid="event-detail-error">
              {error}
            </p>
          )}
        </div>
      )}
    </aside>
  );
}
