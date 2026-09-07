"use client";

import type { CalendarEvent } from "@mola/shared";
import { dayKey, groupByDay, isPinnedRowEvent, monthGridDays } from "./date-math";
import { formatChipTime, kindStyle } from "./event-style";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Deliberately fixed rather than measured: a chip count that changes with the
 * window height makes "+2 more" appear and vanish on resize. Three fits the
 * shortest row this grid ever renders. */
const MAX_CHIPS = 3;

/** Pinned items (all-day, deadlines) read as the day's headline, so they sort
 * above the timed ones regardless of clock position. */
function sortForDay(events: CalendarEvent[]): CalendarEvent[] {
  return [...events].sort((a, b) => {
    const pinned = Number(isPinnedRowEvent(b)) - Number(isPinnedRowEvent(a));
    if (pinned !== 0) return pinned;
    return new Date(a.start).getTime() - new Date(b.start).getTime();
  });
}

export function MonthGrid({
  anchor, today, events, onSelect, onOpenDay, selectedId,
}: {
  anchor: Date;
  today: Date;
  events: CalendarEvent[];
  onSelect: (ev: CalendarEvent) => void;
  onOpenDay: (day: Date) => void;
  selectedId: string | null;
}) {
  const days = monthGridDays(anchor);
  const byDay = groupByDay(events);
  const todayKey = dayKey(today);
  const anchorMonth = anchor.getMonth();

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="month-grid">
      <div className="grid grid-cols-7 border-b border-border">
        {WEEKDAYS.map((label) => (
          <div key={label} className="px-2 py-1.5 text-xs font-medium uppercase tracking-wide text-fg-muted">
            {label}
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        {days.map((day) => {
          const key = dayKey(day);
          const inMonth = day.getMonth() === anchorMonth;
          const isToday = key === todayKey;
          const dayEvents = sortForDay(byDay.get(key) ?? []);
          const shown = dayEvents.slice(0, MAX_CHIPS);
          const hidden = dayEvents.length - shown.length;

          return (
            <div
              key={key}
              data-testid={`month-day-${key}`}
              className={`flex min-h-0 min-w-0 flex-col gap-0.5 border-b border-r border-border p-1 ${
                inMonth ? "bg-surface" : "bg-bg"
              }`}
            >
              <button
                type="button"
                onClick={() => onOpenDay(day)}
                className={`self-start rounded-full px-1.5 py-0.5 text-xs tabular-nums hover:bg-fg/10 ${
                  isToday
                    ? "bg-accent font-semibold text-accent-fg hover:bg-accent"
                    : inMonth ? "text-fg" : "text-fg-muted/60"
                }`}
                aria-label={day.toDateString()}
              >
                {day.getDate()}
              </button>

              <div className="flex min-h-0 flex-col gap-0.5 overflow-hidden">
                {shown.map((ev) => {
                  const style = kindStyle(ev.kind);
                  const time = formatChipTime(ev);
                  return (
                    <button
                      key={`${key}-${ev.id}`}
                      type="button"
                      data-testid={`event-chip-${ev.id}`}
                      onClick={() => onSelect(ev)}
                      className={`flex w-full items-baseline gap-1 truncate rounded border px-1 py-px text-left text-xs leading-snug ${style.chip} ${
                        selectedId === ev.id ? "ring-1 ring-accent" : ""
                      } ${ev.completedAt ? "opacity-55" : ""}`}
                    >
                      {time && <span className="shrink-0 tabular-nums opacity-70">{time}</span>}
                      <span className={`truncate ${ev.completedAt ? "line-through" : ""}`}>{ev.title}</span>
                    </button>
                  );
                })}
                {hidden > 0 && (
                  <button
                    type="button"
                    data-testid={`month-more-${key}`}
                    onClick={() => onOpenDay(day)}
                    className="px-1 text-left text-xs text-fg-muted hover:text-fg"
                  >
                    +{hidden} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
