"use client";

import { useEffect, useRef } from "react";
import type { CalendarEvent } from "@mola/shared";
import { dayKey, groupByDay, isPinnedRowEvent, layoutDay, minutesInto } from "./date-math";
import { formatChipTime, formatTimeRange, kindStyle } from "./event-style";

const HOUR_PX = 48;
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const GUTTER_PX = 56;
/** Where the grid is scrolled on open. Nobody needs to look at 3am first. */
const INITIAL_HOUR = 7;

function hourLabel(hour: number): string {
  if (hour === 0) return "";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h} ${hour < 12 ? "AM" : "PM"}`;
}

/**
 * Week and day are the same surface with a different column count — the hour
 * gutter, the pinned all-day row, the overlap layout and the current-time line
 * are identical, and duplicating them into two components is how they drift.
 */
export function TimeGrid({
  days, today, now, events, onSelect, selectedId, dense,
}: {
  days: Date[];
  today: Date;
  now: Date;
  events: CalendarEvent[];
  onSelect: (ev: CalendarEvent) => void;
  selectedId: string | null;
  /** Day view has a full column of width, so its blocks carry more detail. */
  dense: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const byDay = groupByDay(events);
  const todayKey = dayKey(today);
  const columns = `${GUTTER_PX}px repeat(${days.length}, minmax(0,1fr))`;

  useEffect(() => {
    scroller.current?.scrollTo({ top: INITIAL_HOUR * HOUR_PX });
  }, []);

  const pinnedByDay = days.map((day) => (byDay.get(dayKey(day)) ?? []).filter(isPinnedRowEvent));
  const hasPinned = pinnedByDay.some((list) => list.length > 0);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="week-grid">
      {/* Day headers */}
      <div className="grid border-b border-border" style={{ gridTemplateColumns: columns }}>
        <div />
        {days.map((day) => {
          const isToday = dayKey(day) === todayKey;
          return (
            <div key={dayKey(day)} className="border-l border-border px-2 py-1.5 text-center">
              <div className="text-xs uppercase tracking-wide text-fg-muted">
                {day.toLocaleDateString(undefined, { weekday: "short" })}
              </div>
              <div
                className={`mx-auto mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm tabular-nums ${
                  isToday ? "bg-accent font-semibold text-accent-fg" : "text-fg"
                }`}
              >
                {day.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Pinned row — all-day items and pure deadlines, above the clock. */}
      <div
        className="grid border-b border-border bg-bg"
        style={{ gridTemplateColumns: columns }}
        data-testid="allday-row"
      >
        <div className="px-2 py-1 text-right text-xs text-fg-muted">
          {hasPinned ? "Due" : ""}
        </div>
        {days.map((day, i) => (
          <div key={dayKey(day)} className="min-w-0 border-l border-border p-1">
            <div className="flex max-h-24 flex-col gap-0.5 overflow-y-auto">
              {pinnedByDay[i]!.map((ev) => {
                const style = kindStyle(ev.kind);
                return (
                  <button
                    key={ev.id}
                    type="button"
                    data-testid={`event-chip-${ev.id}`}
                    onClick={() => onSelect(ev)}
                    className={`flex w-full items-baseline gap-1 rounded border px-1.5 py-0.5 text-left text-xs leading-snug ${style.chip} ${
                      selectedId === ev.id ? "ring-1 ring-accent" : ""
                    } ${ev.completedAt ? "opacity-55" : ""}`}
                  >
                    <span className={`truncate ${ev.completedAt ? "line-through" : ""}`}>{ev.title}</span>
                    {!ev.allDay && (
                      <span className="ml-auto shrink-0 tabular-nums opacity-70">{formatChipTime(ev)}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Time grid */}
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto" data-testid="time-grid">
        <div className="grid" style={{ gridTemplateColumns: columns }}>
          <div className="relative" style={{ height: 24 * HOUR_PX }}>
            {HOURS.map((h) => (
              <div
                key={h}
                className="absolute right-2 -translate-y-1/2 text-xs tabular-nums text-fg-muted"
                style={{ top: h * HOUR_PX }}
              >
                {hourLabel(h)}
              </div>
            ))}
          </div>

          {days.map((day) => {
            const isToday = dayKey(day) === todayKey;
            const slots = layoutDay(day, byDay.get(dayKey(day)) ?? []);
            return (
              <div
                key={dayKey(day)}
                className="relative border-l border-border"
                style={{ height: 24 * HOUR_PX }}
              >
                {HOURS.map((h) => (
                  <div
                    key={h}
                    className="absolute inset-x-0 border-t border-border"
                    style={{ top: h * HOUR_PX }}
                  />
                ))}

                {slots.map(({ event: ev, startMin, endMin, column, columns: cols }) => {
                  const style = kindStyle(ev.kind);
                  const height = Math.max(((endMin - startMin) / 60) * HOUR_PX, 18);
                  return (
                    <button
                      key={ev.id}
                      type="button"
                      data-testid={`event-chip-${ev.id}`}
                      onClick={() => onSelect(ev)}
                      className={`absolute overflow-hidden rounded-md border px-1.5 py-0.5 text-left leading-tight ${style.chip} ${
                        selectedId === ev.id ? "ring-2 ring-accent" : ""
                      } ${ev.completedAt ? "opacity-55" : ""}`}
                      style={{
                        top: (startMin / 60) * HOUR_PX,
                        height,
                        left: `calc(${(column / cols) * 100}% + 2px)`,
                        width: `calc(${(1 / cols) * 100}% - 4px)`,
                      }}
                    >
                      <div className={`truncate text-xs font-medium ${ev.completedAt ? "line-through" : ""}`}>
                        {ev.title}
                      </div>
                      {height >= 34 && (
                        <div className="truncate text-xs opacity-75">{formatTimeRange(ev)}</div>
                      )}
                      {dense && height >= 52 && ev.location && (
                        <div className="truncate text-xs opacity-75">{ev.location}</div>
                      )}
                    </button>
                  );
                })}

                {isToday && (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-10 border-t border-red-500"
                    style={{ top: minutesInto(day, now) * (HOUR_PX / 60) }}
                    data-testid="now-line"
                  >
                    <span className="absolute -left-1 -top-1 block h-2 w-2 rounded-full bg-red-500" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
