/**
 * Pure logic behind the Plan tab and the home-screen nudge.
 *
 * There is no component-test harness in this app (vitest.config.ts runs in
 * `node`), so a decision made inside a renderer is a decision nothing checks.
 * The parts with real behaviour live here instead: which local day a
 * timestamp falls on, which proposal leads the page, which two or three
 * things are worth interrupting the student with, and what an amendment
 * actually says.
 */
import type { CalendarEvent, PlannedItem, PlanPayload, TaskView } from "@mola/shared";

export type PlanHorizon = "day" | "week" | "semester";
export type PlanStatus = "proposed" | "approved" | "amended" | "superseded";

/** Contract D's `GET /api/plan` row, with `payload` already through its zod schema. */
export type PlanRecord = {
  id: string;
  horizon: PlanHorizon;
  periodStart: string;
  periodEnd: string | null;
  status: PlanStatus;
  payload: PlanPayload;
  approvedAt: string | null;
  parentPlanId: string | null;
};

// ── Dates ────────────────────────────────────────────────────────────────────

/**
 * A plan date is a calendar day in the student's own timezone (contract B) —
 * `toISOString()` would shift a Monday evening in UTC-5 onto Tuesday, moving
 * work to the wrong day, so every day key is built from local components.
 */
export function localDayKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** `new Date("2026-09-08")` is UTC midnight; a bare day key has to stay local. */
export function parseDay(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return new Date(value);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** Whole calendar days from `now` to `when`. Rounds, so a DST week still counts 1. */
export function daysUntil(when: string | Date, now: Date): number {
  const target = typeof when === "string" ? parseDay(when) : when;
  const a = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

/** "today" / "tomorrow" / "Thursday" / "Sep 24" — never a bare date for something imminent. */
export function describeWhen(when: string | Date, now: Date): string {
  const days = daysUntil(when, now);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days < -1) return `${-days} days ago`;
  const date = typeof when === "string" ? parseDay(when) : when;
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: "long" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function shortDate(when: string | Date): string {
  const date = typeof when === "string" ? parseDay(when) : when;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Clock time for a spanned event; empty for an all-day one. */
export function clockTime(iso: string, allDay: boolean): string {
  if (allDay) return "";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function addDays(date: Date, count: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count);
}

// ── Week shaping ─────────────────────────────────────────────────────────────

export type WeekDay = { date: string; items: PlannedItem[] };

/**
 * Seven consecutive days from `weekStart`, whether or not the planner emitted
 * a bucket for each. An empty Wednesday is information — it means nothing is
 * planned — and a payload that simply omits it would otherwise render as a
 * six-day week with Thursday sitting where Wednesday belongs.
 */
export function weekDays(weekStart: string, days: WeekDay[]): WeekDay[] {
  const byDate = new Map(days.map((d) => [d.date, d.items]));
  const start = parseDay(weekStart);
  return Array.from({ length: 7 }, (_, i) => {
    const date = localDayKey(addDays(start, i));
    return { date, items: byDate.get(date) ?? [] };
  });
}

export function totalMinutes(items: { estimatedMinutes?: number | null }[]): number {
  return items.reduce((sum, item) => sum + (item.estimatedMinutes ?? 0), 0);
}

/** "1h 30m" / "45m" — a plan block is minutes, and 90 reads worse than 1h 30m. */
export function formatMinutes(minutes: number): string {
  if (minutes <= 0) return "";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export function summarizeTasks(tasks: TaskView[]): { done: number; total: number; minutesLeft: number } {
  const done = tasks.filter((t) => t.status === "done").length;
  const minutesLeft = totalMinutes(tasks.filter((t) => t.status === "todo"));
  return { done, total: tasks.length, minutesLeft };
}

// ── Which proposal the page leads with (§5) ──────────────────────────────────

/**
 * §5: a proposal generated on Sunday and never answered persists and is
 * presented on next open, before anything else. So the Plan tab leads with an
 * unanswered proposal whatever day it is.
 *
 * When several are outstanding the semester re-proposal from the end-of-week
 * review goes first — it is the one that explains itself in terms of what the
 * student already did, and the week that follows from it is downstream of the
 * answer.
 */
const PROPOSAL_RANK: Record<PlanHorizon, number> = { semester: 1, week: 2, day: 3 };

/**
 * `approvedAt`, not `status`, is what says a plan is still an open question.
 * Amending sets `status: "amended"` (contract D) whether the plan was already
 * accepted or not, so status alone would both drop a proposal out of the gate
 * the moment the student edited it and drag an accepted plan back into it.
 */
export function awaitsAnswer(plan: PlanRecord | null | undefined): plan is PlanRecord {
  return !!plan && plan.approvedAt === null && plan.status !== "superseded";
}

export function pickLeadProposal(plans: (PlanRecord | null | undefined)[]): PlanRecord | null {
  const proposed = plans.filter(awaitsAnswer);
  if (proposed.length === 0) return null;

  return proposed.slice().sort((a, b) => {
    const aReview = hasReview(a) ? 0 : 1;
    const bReview = hasReview(b) ? 0 : 1;
    if (aReview !== bReview) return aReview - bReview;
    return PROPOSAL_RANK[a.horizon] - PROPOSAL_RANK[b.horizon];
  })[0]!;
}

export function planReview(plan: PlanRecord | null | undefined) {
  if (!plan || plan.payload.horizon !== "semester") return null;
  return plan.payload.review ?? null;
}

function hasReview(plan: PlanRecord): boolean {
  return planReview(plan) !== null;
}

// ── The home-screen nudge ────────────────────────────────────────────────────

/** How far ahead the nudge looks. Beyond this it stops being "next up". */
export const NUDGE_HORIZON_DAYS = 5;
/** Lectures and work shifts are context, not things to act on. */
const ACTIONABLE_KINDS: ReadonlySet<CalendarEvent["kind"]> = new Set(["deadline", "assignment", "exam"]);

export type Nudge =
  | { key: string; kind: "review"; plan: PlanRecord; basedOnWeekStart: string; observations: string[] }
  | { key: string; kind: "proposal"; plan: PlanRecord }
  | { key: string; kind: "event"; event: CalendarEvent; days: number; alsoThatDay: CalendarEvent[] }
  | { key: string; kind: "task"; task: TaskView };

/** Everything else worth knowing about on the same day — what turns "your
 * project is due Thursday" into "…and you have a quiz that morning". */
export function sameDayEvents(events: CalendarEvent[], target: CalendarEvent): CalendarEvent[] {
  const day = localDayKey(new Date(target.start));
  return events
    .filter((e) => e.id !== target.id && !e.completedAt && ACTIONABLE_KINDS.has(e.kind))
    .filter((e) => localDayKey(new Date(e.start)) === day)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

/**
 * The two or three things worth surfacing above the composer, in the order
 * they earn the space: an unanswered proposal first (it is a question already
 * asked of the student), then what is actually coming due, then today's work.
 * Capped hard — this sits above a composer, it is not a dashboard.
 */
export function selectNudges(input: {
  now: Date;
  tasks: TaskView[];
  events: CalendarEvent[];
  plans: (PlanRecord | null | undefined)[];
  limit?: number;
}): Nudge[] {
  const { now, tasks, events, plans, limit = 3 } = input;
  const out: Nudge[] = [];

  const lead = pickLeadProposal(plans);
  const review = planReview(lead);
  if (lead && review) {
    out.push({
      key: `review:${lead.id}`, kind: "review", plan: lead,
      basedOnWeekStart: review.basedOnWeekStart, observations: review.observations,
    });
  } else if (lead) {
    out.push({ key: `proposal:${lead.id}`, kind: "proposal", plan: lead });
  }

  const upcoming = events
    .filter((e) => !e.completedAt && ACTIONABLE_KINDS.has(e.kind))
    .map((event) => ({ event, days: daysUntil(new Date(event.start), now) }))
    .filter(({ days }) => days >= 0 && days <= NUDGE_HORIZON_DAYS)
    .sort((a, b) => Date.parse(a.event.start) - Date.parse(b.event.start))
    .slice(0, 2);

  for (const { event, days } of upcoming) {
    out.push({ key: `event:${event.id}`, kind: "event", event, days, alsoThatDay: sameDayEvents(events, event) });
  }

  for (const task of tasks) {
    if (out.length >= limit) break;
    if (task.status !== "todo") continue;
    out.push({ key: `task:${task.id}`, kind: "task", task });
  }

  return out.slice(0, limit);
}

// ── Amendment payloads (contract D, `POST /api/plan/:id/amend`) ──────────────

export type AmendmentAction =
  | "added" | "removed" | "rescheduled" | "resized" | "completed" | "skipped" | "reordered";

export type PlanAmendment = {
  itemId?: string;
  action: AmendmentAction;
  before?: unknown;
  after?: unknown;
  reason?: string;
};

/**
 * `before`/`after` carry only what changed about the block's placement, plus
 * the `date` bucket it lives in — the whole item only where there is no
 * "before" or no "after" to point at. A day plan has one bucket, so moving a
 * block out of it uses the same `{ date }` shape a week plan does.
 */
export function rescheduleAmendment(
  item: PlannedItem, fromDate: string, toDate: string, reason?: string,
): PlanAmendment {
  return withReason({ itemId: item.id, action: "rescheduled", before: { date: fromDate }, after: { date: toDate } }, reason);
}

export function resizeAmendment(item: PlannedItem, minutes: number, reason?: string): PlanAmendment {
  return withReason({
    itemId: item.id, action: "resized",
    before: { estimatedMinutes: item.estimatedMinutes ?? null },
    after: { estimatedMinutes: minutes },
  }, reason);
}

export function removeAmendment(item: PlannedItem, fromDate: string, reason?: string): PlanAmendment {
  return withReason({ itemId: item.id, action: "removed", before: { date: fromDate, item }, after: null }, reason);
}

export function addAmendment(item: PlannedItem, onDate: string, reason?: string): PlanAmendment {
  return withReason({ itemId: item.id, action: "added", before: null, after: { date: onDate, item } }, reason);
}

/**
 * A semester milestone has no `id` of its own in contract B — only
 * `plannedItemSchema` carries one — so a milestone amendment cannot set
 * `itemId` and has to name its subject by content instead. `before` is the
 * milestone as it stands; that is what J3 matches on when applying it.
 */
export type MilestoneRef = { title: string; targetDate: string };

export function milestoneRescheduleAmendment(
  milestone: MilestoneRef, targetDate: string, reason?: string,
): PlanAmendment {
  return withReason({
    action: "rescheduled",
    before: { title: milestone.title, targetDate: milestone.targetDate },
    after: { title: milestone.title, targetDate },
  }, reason);
}

export function milestoneRemoveAmendment(milestone: MilestoneRef, reason?: string): PlanAmendment {
  return withReason({ action: "removed", before: { milestone }, after: null }, reason);
}

/** An empty box is not a reason — only send the field when the student typed one. */
function withReason(amendment: PlanAmendment, reason?: string): PlanAmendment {
  const trimmed = reason?.trim();
  return trimmed ? { ...amendment, reason: trimmed } : amendment;
}
