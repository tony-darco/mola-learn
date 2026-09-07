"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CALENDAR_VIEWS, type CalendarEvent, type CalendarView } from "@mola/shared";
import type { CourseOption } from "@/lib/artifacts/filters";
import { addDays, startOfDay, startOfWeek, rangeFor, step, weekDays } from "./date-math";
import { MonthGrid } from "./MonthGrid";
import { TimeGrid } from "./TimeGrid";
import { EventDetail } from "./EventDetail";
import { FeedsDrawer } from "./FeedsDrawer";

const VIEW_LABEL: Record<CalendarView, string> = { month: "Month", week: "Week", day: "Day" };

const toolbarButton =
  "rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-fg hover:bg-bg disabled:opacity-50";
const selectClass =
  "rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-fg focus:outline-none";

function titleFor(view: CalendarView, anchor: Date): string {
  if (view === "month") return anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  if (view === "day") {
    return anchor.toLocaleDateString(undefined, {
      weekday: "long", month: "long", day: "numeric", year: "numeric",
    });
  }
  const monday = startOfWeek(anchor);
  const sunday = addDays(monday, 6);
  const sameMonth = monday.getMonth() === sunday.getMonth();
  const left = monday.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  // The right half is composed rather than formatted in one call. Asking Intl
  // for year+day without month has no standard pattern, and it answers with a
  // literal "2026 (day: 13)" — which is exactly what this header used to read.
  const right = sameMonth
    ? String(sunday.getDate())
    : sunday.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${left} – ${right}, ${sunday.getFullYear()}`;
}

/**
 * The whole calendar surface. Deliberately one client component holding the
 * navigation state, the fetch and the selection: month/week/day are three
 * renderings of the same window, and splitting the state across them means a
 * course filter chosen in month view is silently lost on the way to week.
 *
 * Nothing renders until after mount. The anchor date, "today", and the
 * current-time line are all read from the viewer's clock and timezone, and a
 * server render of those would hydrate into a different day for anyone whose
 * offset differs from the server's.
 */
export function CalendarSurface({ courses }: { courses: CourseOption[] }) {
  const [mounted, setMounted] = useState(false);
  const [view, setView] = useState<CalendarView>("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const [today, setToday] = useState(() => new Date());
  const [now, setNow] = useState(() => new Date());
  const [courseFilter, setCourseFilter] = useState("all");

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toggleBusy, setToggleBusy] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [feedsOpen, setFeedsOpen] = useState(false);

  useEffect(() => {
    const stamp = new Date();
    setMounted(true);
    setAnchor(stamp);
    setToday(startOfDay(stamp));
    setNow(stamp);
  }, []);

  // One minute is the resolution the now-line is drawn at; anything faster is
  // re-rendering the grid for a sub-pixel move.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const { from, to } = useMemo(() => rangeFor(view, anchor), [view, anchor]);
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  // Sequence guard: paging quickly through months lands responses out of
  // order, and a stale one overwriting a newer one shows the wrong month.
  const requestSeq = useRef(0);

  useEffect(() => {
    if (!mounted) return;
    const seq = ++requestSeq.current;
    const params = new URLSearchParams({ from: fromIso, to: toIso });
    if (courseFilter !== "all") params.set("courseId", courseFilter);

    setLoading(true);
    fetch(`/api/calendar/events?${params}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`failed to load events (${res.status})`);
        return (await res.json()) as { events: CalendarEvent[] };
      })
      .then((data) => {
        if (seq !== requestSeq.current) return;
        setEvents(data.events);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        if (seq !== requestSeq.current) return;
        setEvents([]);
        setLoadError(err instanceof Error ? err.message : "failed to load events");
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false);
      });
  }, [mounted, fromIso, toIso, courseFilter]);

  const selected = useMemo(
    () => events.find((e) => e.id === selectedId) ?? null,
    [events, selectedId],
  );

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const courseMap = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);
  function courseLabel(courseId: string | null): string | null {
    if (!courseId) return null;
    const c = courseMap.get(courseId);
    if (!c) return null;
    return c.number ? `${c.number} — ${c.name}` : c.name;
  }

  /**
   * Optimistic check-off: the chip and the panel flip immediately, and the
   * server's own row replaces them when it lands. A failure puts the previous
   * value back rather than leaving a checkbox that lies about what was saved.
   */
  async function toggleComplete(ev: CalendarEvent) {
    const previous = ev.completedAt;
    const next = previous ? null : new Date().toISOString();
    const apply = (value: string | null) =>
      setEvents((list) => list.map((e) => (e.id === ev.id ? { ...e, completedAt: value } : e)));

    setToggleBusy(true);
    setToggleError(null);
    apply(next);

    try {
      const res = await fetch(`/api/calendar/events/${ev.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ completedAt: next }),
      });
      if (!res.ok) throw new Error(`could not save (${res.status})`);
      const { event } = (await res.json()) as { event: CalendarEvent };
      setEvents((list) => list.map((e) => (e.id === event.id ? event : e)));
    } catch (err) {
      apply(previous);
      setToggleError(err instanceof Error ? err.message : "could not save");
    } finally {
      setToggleBusy(false);
    }
  }

  function openDay(day: Date) {
    setAnchor(day);
    setView("day");
  }

  return (
    <div className="flex h-full min-h-0 flex-1" data-testid="calendar-surface">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3"
          data-testid="calendar-toolbar"
        >
          <button
            type="button"
            data-testid="calendar-today"
            className={toolbarButton}
            onClick={() => setAnchor(new Date())}
          >
            Today
          </button>
          <div className="flex">
            <button
              type="button"
              aria-label="Previous"
              data-testid="calendar-prev"
              className={`${toolbarButton} rounded-r-none`}
              onClick={() => setAnchor((a) => step(view, a, -1))}
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="Next"
              data-testid="calendar-next"
              className={`${toolbarButton} -ml-px rounded-l-none`}
              onClick={() => setAnchor((a) => step(view, a, 1))}
            >
              ›
            </button>
          </div>

          <h1 className="ml-1 text-lg font-semibold text-fg" data-testid="calendar-title">
            {mounted ? titleFor(view, anchor) : "Calendar"}
          </h1>

          {loading && <span className="text-sm text-fg-muted">Loading…</span>}
          {loadError && (
            <span className="text-sm text-red-600 dark:text-red-400" data-testid="calendar-error">
              {loadError}
            </span>
          )}

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <select
              className={selectClass}
              data-testid="course-filter"
              aria-label="Filter by course"
              value={courseFilter}
              onChange={(e) => setCourseFilter(e.target.value)}
            >
              <option value="all">All courses</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>{c.number ? `${c.number} — ${c.name}` : c.name}</option>
              ))}
            </select>

            <div className="flex rounded-lg border border-border bg-surface p-0.5">
              {CALENDAR_VIEWS.map((v) => (
                <button
                  key={v}
                  type="button"
                  data-testid={`view-${v}`}
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                  className={`rounded-md px-2.5 py-1 text-sm ${
                    view === v ? "bg-accent font-medium text-accent-fg" : "text-fg-muted hover:text-fg"
                  }`}
                >
                  {VIEW_LABEL[v]}
                </button>
              ))}
            </div>

            <button
              type="button"
              data-testid="feeds-button"
              className={toolbarButton}
              onClick={() => setFeedsOpen(true)}
            >
              Feeds
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1">
          {!mounted ? (
            <div className="p-4 text-sm text-fg-muted">Loading calendar…</div>
          ) : view === "month" ? (
            <MonthGrid
              anchor={anchor}
              today={today}
              events={events}
              selectedId={selectedId}
              onSelect={(ev) => { setSelectedId(ev.id); setToggleError(null); }}
              onOpenDay={openDay}
            />
          ) : (
            <TimeGrid
              days={view === "week" ? weekDays(anchor) : [startOfDay(anchor)]}
              today={today}
              now={now}
              events={events}
              selectedId={selectedId}
              dense={view === "day"}
              onSelect={(ev) => { setSelectedId(ev.id); setToggleError(null); }}
            />
          )}
        </div>
      </div>

      {selected && (
        <EventDetail
          event={selected}
          courseLabel={courseLabel(selected.courseId) ?? selected.courseName ?? null}
          busy={toggleBusy}
          error={toggleError}
          onClose={() => setSelectedId(null)}
          onToggleComplete={toggleComplete}
        />
      )}

      <FeedsDrawer open={feedsOpen} onClose={() => setFeedsOpen(false)} />
    </div>
  );
}
