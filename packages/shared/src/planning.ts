/**
 * CONTRACT 7 — calendar + planning payloads (Agent J). FROZEN.
 *
 * `plans.payload` and `schedule_items` rows cross four boundaries: the sync
 * workers write them, the planning agent proposes them, the Plan/Schedule UI
 * renders them, and the `read_schedule` tool serialises them into Layer 2 of
 * the context assembler. That is the same four-way exposure that made the
 * artifact schema (contract 6) worth freezing, so these get the same treatment:
 * extend the union here first, never widen a payload to `any`.
 *
 * Ordering rule, from §5 and worth stating because it is easy to lose: an
 * amendment to today or this week is NEVER silently applied to the semester
 * plan. Amendments accumulate in `plan_amendments`; the end-of-week review
 * reads that pattern and re-proposes the semester through the same
 * propose → amend → accept gate the student already uses.
 */
import { z } from "zod";

// ── Planned items ────────────────────────────────────────────────────────────

export const PLANNED_ITEM_KINDS = [
  "study", "homework", "review", "reading", "practice_quiz", "flashcards", "break",
] as const;
export type PlannedItemKind = (typeof PLANNED_ITEM_KINDS)[number];

/**
 * One block inside a plan. `id` is stable across re-proposals of the same plan
 * so an amendment can name the block it changed, and so a materialised task can
 * point back at it without being duplicated on the next propose.
 */
export const plannedItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  kind: z.enum(PLANNED_ITEM_KINDS),
  courseId: z.string().uuid().nullable().optional(),
  estimatedMinutes: z.number().int().positive().nullable().optional(),
  /** ISO 8601. Optional: not every block is time-boxed to a clock slot. */
  startAt: z.string().datetime({ offset: true }).nullable().optional(),
  /** The deadline/exam this block is in service of, when there is one. */
  relatedScheduleItemId: z.string().uuid().nullable().optional(),
  /** One line of "why this, now" — shown in the UI, and what makes an
   * amendment legible to the end-of-week review. */
  rationale: z.string().nullable().optional(),
});
export type PlannedItem = z.infer<typeof plannedItemSchema>;

// ── Day ──────────────────────────────────────────────────────────────────────

export const dayPlanPayloadSchema = z.object({
  horizon: z.literal("day"),
  /** YYYY-MM-DD in the student's local timezone, not UTC — a plan is a
   * calendar day, and shifting it by an offset moves work to the wrong day. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  summary: z.string().optional(),
  items: z.array(plannedItemSchema),
});
export type DayPlanPayload = z.infer<typeof dayPlanPayloadSchema>;

// ── Week ─────────────────────────────────────────────────────────────────────

export const weekPlanPayloadSchema = z.object({
  horizon: z.literal("week"),
  /** Monday, YYYY-MM-DD. */
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  summary: z.string(),
  /** Per-course emphasis for the week — what Layer 2.2 stamps into context. */
  focus: z.array(z.object({
    courseId: z.string().uuid().nullable(),
    text: z.string(),
  })).default([]),
  days: z.array(z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    items: z.array(plannedItemSchema),
  })),
  /** Things the planner thinks could go wrong ("three deadlines land Thursday"). */
  risks: z.array(z.string()).default([]),
});
export type WeekPlanPayload = z.infer<typeof weekPlanPayloadSchema>;

// ── Semester ─────────────────────────────────────────────────────────────────

export const semesterPlanPayloadSchema = z.object({
  horizon: z.literal("semester"),
  summary: z.string(),
  goals: z.array(z.object({
    courseId: z.string().uuid().nullable(),
    text: z.string(),
  })).default([]),
  milestones: z.array(z.object({
    title: z.string(),
    courseId: z.string().uuid().nullable().optional(),
    /** YYYY-MM-DD. */
    targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    kind: z.enum(["exam", "project", "unit", "checkpoint"]),
    relatedScheduleItemId: z.string().uuid().nullable().optional(),
  })).default([]),
  /**
   * Present only on a semester plan re-proposed by the end-of-week review.
   * `basedOnWeekStart` names the week whose amendment pattern drove it, so the
   * UI can show "because last week slipped" rather than an unexplained diff.
   */
  review: z.object({
    basedOnWeekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    observations: z.array(z.string()),
    proposedChanges: z.array(z.string()),
  }).nullable().optional(),
});
export type SemesterPlanPayload = z.infer<typeof semesterPlanPayloadSchema>;

export const planPayloadSchema = z.discriminatedUnion("horizon", [
  dayPlanPayloadSchema, weekPlanPayloadSchema, semesterPlanPayloadSchema,
]);
export type PlanPayload = z.infer<typeof planPayloadSchema>;

// ── Calendar events (the read model the UI and the tool both consume) ─────────

export const CALENDAR_VIEWS = ["month", "week", "day"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

/**
 * A schedule_items row flattened for rendering. `start` is always populated
 * (`startAt ?? dueAt`) so a month grid never has to special-case a pure
 * deadline against a spanned lecture.
 */
export type CalendarEvent = {
  id: string;
  title: string;
  kind: "deadline" | "recurring_task" | "study_session" | "class" | "exam" | "assignment" | "event";
  source: "ics" | "google" | "student" | "chat" | "plan";
  courseId: string | null;
  courseName?: string | null;
  /** ISO 8601. */
  start: string;
  end: string | null;
  allDay: boolean;
  location: string | null;
  description: string | null;
  /** Non-null once checked off — assignments and deadlines only. */
  completedAt: string | null;
};

export type TaskView = {
  id: string;
  title: string;
  notes: string | null;
  status: "todo" | "done" | "skipped";
  source: "plan" | "student" | "agent";
  courseId: string | null;
  courseName?: string | null;
  scheduledFor: string | null;
  estimatedMinutes: number | null;
  completedAt: string | null;
  scheduleItemId: string | null;
};

// ── Job kinds handled by the TypeScript worker ───────────────────────────────

/**
 * These share the `jobs` table with the Python ingest worker, which claims
 * ONLY `ingest_document` (see apps/ingest/ingest/jobs.py). Both pollers filter
 * by kind, so one queue serves both without either seeing the other's rows.
 */
export const CALENDAR_JOB_KINDS = [
  "calendar_sync_ics",
  "calendar_sync_google",
  "calendar_renew_watch",
  "plan_week_propose",
  "plan_day_propose",
  "plan_week_review",
] as const;
export type CalendarJobKind = (typeof CALENDAR_JOB_KINDS)[number];
