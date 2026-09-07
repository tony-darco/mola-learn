/**
 * Kind → chip colour. Translucent backgrounds rather than solid ones, because
 * the same chip sits on `bg-surface` in the month grid and on the ruled time
 * grid in week view — an opacity wash over the page ground works on either, a
 * fixed tint does not.
 *
 * Text is deliberately `text-fg`, the theme's own foreground token, rather
 * than a per-hue shade. Tailwind's `dark:` variant keys off the OS setting,
 * but the default "Mola" theme is light-only and ignores it (see globals.css),
 * so `dark:text-sky-200` was winning on a light page and rendering the labels
 * nearly invisible on any machine set to dark mode. Colour therefore carries
 * the CATEGORY (wash + dot) and the theme carries the contrast, which is the
 * only combination that holds across both themes.
 */
import type { CalendarEvent } from "@mola/shared";

type KindStyle = { chip: string; dot: string; label: string };

const NEUTRAL: KindStyle = {
  chip: "bg-fg/10 text-fg border-fg/15",
  dot: "bg-fg/50",
  label: "Event",
};

const BY_KIND: Record<CalendarEvent["kind"], KindStyle> = {
  class: {
    chip: "bg-sky-500/15 text-fg border-sky-500/30",
    dot: "bg-sky-500",
    label: "Class",
  },
  exam: {
    chip: "bg-red-500/15 text-fg border-red-500/30",
    dot: "bg-red-500",
    label: "Exam",
  },
  assignment: {
    chip: "bg-amber-500/20 text-fg border-amber-500/35",
    dot: "bg-amber-500",
    label: "Assignment",
  },
  deadline: {
    chip: "bg-amber-500/20 text-fg border-amber-500/35",
    dot: "bg-amber-500",
    label: "Deadline",
  },
  study_session: {
    chip: "bg-emerald-500/15 text-fg border-emerald-500/30",
    dot: "bg-emerald-500",
    label: "Study session",
  },
  recurring_task: {
    chip: "bg-violet-500/15 text-fg border-violet-500/30",
    dot: "bg-violet-500",
    label: "Recurring task",
  },
  event: NEUTRAL,
};

export function kindStyle(kind: CalendarEvent["kind"]): KindStyle {
  return BY_KIND[kind] ?? NEUTRAL;
}

/** Only these two are things a student checks off (contract D's PATCH path). */
export function isCheckable(ev: CalendarEvent): boolean {
  return ev.kind === "assignment" || ev.kind === "deadline";
}

const SOURCE_LABEL: Record<CalendarEvent["source"], string> = {
  ics: "Calendar feed",
  google: "Google Calendar",
  student: "Added by you",
  chat: "From a conversation",
  plan: "From your plan",
};

export function sourceLabel(source: CalendarEvent["source"]): string {
  return SOURCE_LABEL[source] ?? source;
}

/** "10:00 AM", or "10:00 AM – 10:50 AM" when there is a span worth showing. */
export function formatTimeRange(ev: CalendarEvent): string {
  if (ev.allDay) return "All day";
  const start = new Date(ev.start);
  const startText = start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (!ev.end) return startText;
  const end = new Date(ev.end);
  if (end.getTime() <= start.getTime()) return startText;
  return `${startText} – ${end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

/** The compact form a chip has room for: "10a", "1:30p", or nothing all-day. */
export function formatChipTime(ev: CalendarEvent): string {
  if (ev.allDay) return "";
  const d = new Date(ev.start);
  const hour = d.getHours() % 12 === 0 ? 12 : d.getHours() % 12;
  const suffix = d.getHours() < 12 ? "a" : "p";
  return d.getMinutes() === 0 ? `${hour}${suffix}` : `${hour}:${String(d.getMinutes()).padStart(2, "0")}${suffix}`;
}
