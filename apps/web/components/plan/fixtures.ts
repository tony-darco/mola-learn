/**
 * Dev-only stand-in for contract D, reached only at `/plan?fixtures=1` (or
 * `?fixtures=review`) and never in production — same arrangement as
 * components/chat/fixtures.ts, and for the same reason: the routes that serve
 * these shapes are being written in parallel, and a renderer nobody has
 * looked at in a browser is a renderer nobody has checked.
 *
 * Every payload goes through `planPayloadSchema` on the way out, so a fixture
 * that drifts from contract B fails here rather than quietly teaching the UI
 * the wrong shape.
 */
import { planPayloadSchema, type CalendarEvent, type TaskView } from "@mola/shared";
import type { PlanApi } from "./api";
import { addDays, localDayKey, type CourseOption, type PlanHorizon, type PlanRecord } from "./plan-logic";

export type FixtureScenario = "default" | "review";

export function parseScenario(value: string | undefined): FixtureScenario | null {
  if (value === "1" || value === "default") return "default";
  if (value === "review") return "review";
  return null;
}

const uuid = (n: number) => `00000000-0000-4000-8000-${`${n}`.padStart(12, "0")}`;

/** Stand-ins for a database nobody has seeded, so the fixture is self-contained
 * the way components/chat/fixtures.ts is. Real courses win when there are any. */
export const FIXTURE_COURSES: CourseOption[] = [
  { id: uuid(11), name: "Principles of Operating Systems", number: "CMSC 421" },
  { id: uuid(12), name: "Linear Algebra", number: "MATH 221" },
];

export function fixtureCourses(courses: CourseOption[]): CourseOption[] {
  return courses.length > 0 ? courses : FIXTURE_COURSES;
}

/** Local clock time on the day `offset` days from `from`. */
function at(from: Date, offset: number, hour: number, minute = 0): Date {
  const date = addDays(from, offset);
  date.setHours(hour, minute, 0, 0);
  return date;
}

/** Days from `from` to the next occurrence of a weekday (0=Sun), today included. */
function until(from: Date, weekday: number): number {
  return (weekday - from.getDay() + 7) % 7;
}

export function makeFixtureApi(courses: CourseOption[], scenario: FixtureScenario = "default"): PlanApi {
  const now = new Date();
  const cs = courses[0]?.id ?? null;
  const math = courses[1]?.id ?? courses[0]?.id ?? null;

  const monday = addDays(now, -((now.getDay() + 6) % 7));
  const thursday = until(now, 4);
  const day = (offset: number) => localDayKey(addDays(now, offset));

  const events: CalendarEvent[] = [
    ev(uuid(1), "MATH 221 — Quiz 3 (eigenvalues)", "exam", math, at(now, thursday, 9, 30), at(now, thursday, 10, 45)),
    ev(uuid(2), "CMSC 421 — Project 1: Shell implementation", "deadline", cs, at(now, thursday, 23, 59), null),
    ev(uuid(3), "MATH 221 — Problem Set 4", "assignment", math, at(now, thursday - 1, 23, 59), null),
    ev(uuid(4), "CMSC 421 — Homework 4: Deadlock detection", "assignment", cs, at(now, thursday + 7, 23, 59), null),
    ev(uuid(5), "MATH 221 — Problem Set 5", "assignment", math, at(now, thursday + 7, 23, 59), null),
    ev(uuid(6), "CMSC 421 Lecture", "class", cs, at(now, 1, 10, 0), at(now, 1, 11, 15)),
    ev(uuid(7), "CMSC 421 — Midterm", "exam", cs, at(now, 23, 10, 0), at(now, 23, 11, 15)),
  ];

  const week: PlanRecord = {
    id: uuid(101),
    horizon: "week",
    periodStart: localDayKey(monday),
    periodEnd: localDayKey(addDays(monday, 6)),
    status: "proposed",
    approvedAt: scenario === "review" ? at(now, -1, 20, 0).toISOString() : null,
    parentPlanId: null,
    payload: planPayloadSchema.parse({
      horizon: "week",
      weekStart: localDayKey(monday),
      summary: "Project 1 and Quiz 3 both land Thursday, so the front half of the week is the shell and the back half is eigenvalues.",
      focus: [
        { courseId: cs, text: "Finish the shell's pipe handling before Wednesday — it is the part that always takes longer than you think." },
        { courseId: math, text: "Eigenvalues by hand, not by calculator. Quiz 3 is closed-book." },
      ],
      risks: [
        "Project 1 is due Thursday at 11:59pm and Quiz 3 is Thursday morning. Thursday cannot hold both.",
        "Problem Set 4 is due Wednesday night, which is the evening you had set aside for the shell.",
      ],
      days: [
        { date: day(0), items: [
          { id: "w1", title: "Shell: pipe and redirection handling", kind: "homework", courseId: cs, estimatedMinutes: 90,
            relatedScheduleItemId: uuid(2), rationale: "The largest unfinished piece, and the one that blocks testing." },
          { id: "w2", title: "Re-read the eigenvalue section", kind: "reading", courseId: math, estimatedMinutes: 30, relatedScheduleItemId: uuid(1) },
        ] },
        { date: day(1), items: [
          { id: "w3", title: "Problem Set 4", kind: "homework", courseId: math, estimatedMinutes: 75, relatedScheduleItemId: uuid(3) },
        ] },
        { date: day(2), items: [
          { id: "w4", title: "Shell: signal handling and cleanup", kind: "homework", courseId: cs, estimatedMinutes: 90, relatedScheduleItemId: uuid(2) },
          { id: "w5", title: "Eigenvalue practice problems", kind: "practice_quiz", courseId: math, estimatedMinutes: 45,
            relatedScheduleItemId: uuid(1), rationale: "Last run before the quiz, while there is still time to fix what it finds." },
        ] },
        { date: day(3), items: [
          { id: "w6", title: "Quiz 3 review — definitions only", kind: "flashcards", courseId: math, estimatedMinutes: 20, relatedScheduleItemId: uuid(1) },
          { id: "w7", title: "Project 1 final pass and submit", kind: "homework", courseId: cs, estimatedMinutes: 60, relatedScheduleItemId: uuid(2) },
        ] },
        { date: day(4), items: [] },
      ],
    }),
  };

  const semester: PlanRecord = {
    id: uuid(102),
    horizon: "semester",
    periodStart: localDayKey(addDays(now, -21)),
    periodEnd: localDayKey(addDays(now, 90)),
    status: scenario === "review" ? "proposed" : "approved",
    approvedAt: scenario === "review" ? null : at(now, -20, 9, 0).toISOString(),
    parentPlanId: null,
    payload: planPayloadSchema.parse({
      horizon: "semester",
      summary: "Two courses that both back-load their work. The plan is to keep CMSC 421's projects off the same weeks as MATH 221's exams.",
      goals: [
        { courseId: cs, text: "Understand scheduling and memory well enough to explain them without notes." },
        { courseId: math, text: "Get to the point where eigenvalue problems are arithmetic, not puzzles." },
      ],
      milestones: [
        { title: "Project 1: Shell implementation", courseId: cs, targetDate: day(thursday), kind: "project", relatedScheduleItemId: uuid(2) },
        { title: "Quiz 3 — eigenvalues", courseId: math, targetDate: day(thursday), kind: "exam", relatedScheduleItemId: uuid(1) },
        { title: "Homework 4 and Problem Set 5", courseId: null, targetDate: day(thursday + 7), kind: "checkpoint" },
        { title: "CMSC 421 Midterm", courseId: cs, targetDate: day(23), kind: "exam", relatedScheduleItemId: uuid(7) },
        { title: "Project 2: Virtual memory", courseId: cs, targetDate: day(29), kind: "project" },
      ],
      review: scenario === "review" ? {
        basedOnWeekStart: localDayKey(addDays(monday, -7)),
        observations: [
          "You moved four of last week's evening blocks to the morning, and finished all four.",
          "Both blocks longer than an hour got shortened before they were done.",
          "The reading you dropped twice was the one with no deadline attached to it.",
        ],
        proposedChanges: [
          "Put CMSC 421's deep work in the morning and leave the evenings for problem sets.",
          "Cap a single block at 50 minutes and plan two of them instead of one long one.",
          "Attach the textbook reading to the quiz it prepares for, so it stops looking optional.",
        ],
      } : null,
    }),
  };

  const plans: Record<PlanHorizon, PlanRecord | null> = { day: null, week, semester };
  let tasks: TaskView[] = [
    task(uuid(201), "Shell: pipe and redirection handling", cs, 90, uuid(2), "todo"),
    task(uuid(202), "Re-read the eigenvalue section", math, 30, uuid(1), "todo"),
    task(uuid(203), "Email the TA about the late policy", null, 10, null, "done"),
  ];

  /** Enough latency to see the loading state and the optimistic check-off. */
  const pause = () => new Promise((r) => setTimeout(r, 200));

  const horizonOf = (planId: string): PlanHorizon =>
    (Object.keys(plans) as PlanHorizon[]).find((h) => plans[h]?.id === planId) ?? "week";

  return {
    async fetchPlan(horizon) {
      await pause();
      return plans[horizon];
    },
    async proposePlan(horizon) {
      await pause();
      return plans[horizon];
    },
    async acceptPlan(planId) {
      await pause();
      const horizon = horizonOf(planId);
      const next: PlanRecord = { ...plans[horizon]!, status: "approved", approvedAt: new Date().toISOString() };
      plans[horizon] = next;
      return next;
    },
    async amendPlan(planId) {
      await pause();
      const horizon = horizonOf(planId);
      const next: PlanRecord = { ...plans[horizon]!, status: "amended" };
      plans[horizon] = next;
      return next;
    },
    async fetchTasks() {
      await pause();
      return tasks;
    },
    async createTask(body) {
      await pause();
      const created = task(
        uuid(300 + tasks.length), body.title, body.courseId ?? null, body.estimatedMinutes ?? null, null, "todo",
      );
      tasks = [...tasks, created];
      return created;
    },
    async patchTask(taskId, patch) {
      await pause();
      const found = tasks.find((t) => t.id === taskId)!;
      const next: TaskView = {
        ...found, ...patch,
        completedAt: patch.status === "done" ? new Date().toISOString() : null,
      };
      tasks = tasks.map((t) => (t.id === taskId ? next : t));
      return next;
    },
    async fetchEvents() {
      await pause();
      return events;
    },
  };

  function task(
    id: string, title: string, courseId: string | null, estimatedMinutes: number | null,
    scheduleItemId: string | null, status: TaskView["status"],
  ): TaskView {
    return {
      id, title, notes: null, status, source: "plan", courseId,
      courseName: courses.find((c) => c.id === courseId)?.name ?? null,
      scheduledFor: at(now, 0, 9, 0).toISOString(),
      estimatedMinutes, scheduleItemId,
      completedAt: status === "done" ? at(now, 0, 8, 30).toISOString() : null,
    };
  }
}

function ev(
  id: string, title: string, kind: CalendarEvent["kind"], courseId: string | null, start: Date, end: Date | null,
): CalendarEvent {
  return {
    id, title, kind, source: "ics", courseId, courseName: null,
    start: start.toISOString(), end: end ? end.toISOString() : null,
    allDay: false, location: null, description: null, completedAt: null,
  };
}
