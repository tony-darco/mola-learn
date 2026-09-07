/**
 * The Plan tab's decisions, tested where they live. Vitest runs in `node`
 * here (see vitest.config.ts) with no DOM and no component harness, so the
 * logic the UI depends on was deliberately kept out of the renderers —
 * components/plan/plan-logic.ts — and this file covers that instead of
 * inventing a rendering setup nothing else in the repo uses.
 */
import { describe, expect, it } from "vitest";
import type { CalendarEvent, TaskView } from "@mola/shared";
import {
  addAmendment, daysUntil, describeWhen, eventWhenLine, groupTasksByDay, localDayKey,
  makeCourseLabel, makeRelatedLabel, milestoneRescheduleAmendment, openProposals, partOfDay,
  pickLeadProposal, proposalStatusLine, removeAmendment, rescheduleAmendment, resizeAmendment,
  sameDayEvents, selectNudges, summarizeTasks, tasksForToday, weekDays,
  type PlanRecord,
} from "../components/plan/plan-logic";

/** A Monday, so week arithmetic reads the way the payload contract describes it. */
const MONDAY = new Date(2026, 8, 7, 9, 0);
const day = (offset: number, hour = 9, minute = 0) =>
  new Date(2026, 8, 7 + offset, hour, minute);

function task(over: Partial<TaskView> = {}): TaskView {
  return {
    id: "t1", title: "Shell: pipe handling", notes: null, status: "todo", source: "plan",
    courseId: null, scheduledFor: day(0).toISOString(), estimatedMinutes: 60,
    completedAt: null, scheduleItemId: null, ...over,
  };
}

function event(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "e1", title: "CMSC 421 — Project 1", kind: "deadline", source: "ics", courseId: null,
    start: day(3, 23, 59).toISOString(), end: null, allDay: false, location: null,
    description: null, completedAt: null, ...over,
  };
}

function plan(over: Partial<PlanRecord> = {}): PlanRecord {
  return {
    id: "p1", horizon: "week", periodStart: "2026-09-07", periodEnd: "2026-09-13",
    status: "proposed", approvedAt: null, parentPlanId: null,
    payload: { horizon: "week", weekStart: "2026-09-07", summary: "", focus: [], days: [], risks: [] },
    ...over,
  };
}

// ── Days ─────────────────────────────────────────────────────────────────────

describe("day keys and distances", () => {
  it("keys a late-evening timestamp to its own local day, not UTC's", () => {
    // 11:30pm local is the next day in UTC anywhere west of Greenwich — the
    // exact shift that would move a task onto tomorrow's list.
    expect(localDayKey(new Date(2026, 8, 7, 23, 30))).toBe("2026-09-07");
  });

  it("counts whole calendar days, not elapsed hours", () => {
    // 11pm Monday to 1am Tuesday is two hours and one day.
    expect(daysUntil(new Date(2026, 8, 8, 1, 0), new Date(2026, 8, 7, 23, 0))).toBe(1);
  });

  it("names near days and dates far ones", () => {
    expect(describeWhen(day(0), MONDAY)).toBe("today");
    expect(describeWhen(day(1), MONDAY)).toBe("tomorrow");
    expect(describeWhen(day(3), MONDAY)).toBe("Thursday");
    expect(describeWhen(day(-1), MONDAY)).toBe("yesterday");
    expect(describeWhen(day(20), MONDAY)).toMatch(/Sep 27/);
  });
});

// ── Week shaping ─────────────────────────────────────────────────────────────

describe("weekDays", () => {
  it("fills the days the planner omitted rather than shifting the rest", () => {
    const days = weekDays("2026-09-07", [{ date: "2026-09-10", items: [] }]);
    expect(days.map((d) => d.date)).toEqual([
      "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10",
      "2026-09-11", "2026-09-12", "2026-09-13",
    ]);
  });
});

// ── Tasks ────────────────────────────────────────────────────────────────────

describe("grouping tasks by day", () => {
  it("buckets by the task's own local day", () => {
    const grouped = groupTasksByDay([
      task({ id: "a", scheduledFor: day(0).toISOString() }),
      task({ id: "b", scheduledFor: day(1).toISOString() }),
      task({ id: "c", scheduledFor: day(0, 22, 45).toISOString() }),
    ]);
    expect(grouped.get("2026-09-07")?.map((t) => t.id)).toEqual(["a", "c"]);
    expect(grouped.get("2026-09-08")?.map((t) => t.id)).toEqual(["b"]);
  });

  it("keeps undated tasks in their own bucket", () => {
    const grouped = groupTasksByDay([task({ id: "a", scheduledFor: null })]);
    expect(grouped.get("")?.map((t) => t.id)).toEqual(["a"]);
  });
});

describe("tasksForToday", () => {
  it("takes today's and the undated, and leaves other days alone", () => {
    const list = tasksForToday([
      task({ id: "today" }),
      task({ id: "tomorrow", scheduledFor: day(1).toISOString() }),
      task({ id: "undated", scheduledFor: null }),
    ], MONDAY);
    expect(list.map((t) => t.id)).toEqual(["today", "undated"]);
  });

  it("sinks checked-off work below what is left", () => {
    const list = tasksForToday([
      task({ id: "done", status: "done" }),
      task({ id: "skipped", status: "skipped" }),
      task({ id: "todo" }),
    ], MONDAY);
    expect(list.map((t) => t.id)).toEqual(["todo", "skipped", "done"]);
  });

  it("summarizes only outstanding minutes", () => {
    expect(summarizeTasks([
      task({ id: "a", estimatedMinutes: 60 }),
      task({ id: "b", estimatedMinutes: 30, status: "done" }),
    ])).toEqual({ done: 1, total: 2, minutesLeft: 60 });
  });
});

// ── Labels ───────────────────────────────────────────────────────────────────

describe("labels", () => {
  it("calls a course by its number when it has one", () => {
    const label = makeCourseLabel([
      { id: "c1", name: "Principles of Operating Systems", number: "CMSC 421" },
      { id: "c2", name: "Seminar", number: null },
    ]);
    expect(label("c1")).toBe("CMSC 421");
    expect(label("c2")).toBe("Seminar");
    expect(label(null)).toBeNull();
    expect(label("gone")).toBeNull();
  });

  it("names the deadline a block serves, and stays quiet when there isn't one", () => {
    const label = makeRelatedLabel([event({ id: "e1", title: "Project 1" })], MONDAY);
    expect(label("e1")).toBe("for Project 1 · Thursday");
    expect(label(null)).toBeNull();
    expect(label("unknown")).toBeNull();
  });
});

// ── The propose → amend → accept gate ────────────────────────────────────────

describe("which proposal is still open", () => {
  it("treats an amended-but-unaccepted plan as still awaiting an answer", () => {
    // Amending sets status "amended" (contract D) — that is a student editing
    // the proposal, not answering it.
    expect(pickLeadProposal([plan({ status: "amended" })])).not.toBeNull();
  });

  it("drops a plan once it has been accepted", () => {
    expect(pickLeadProposal([plan({ status: "approved", approvedAt: day(0).toISOString() })])).toBeNull();
  });

  it("leads with the review re-proposal, then week, then day", () => {
    const review = plan({
      id: "sem", horizon: "semester",
      payload: {
        horizon: "semester", summary: "", goals: [], milestones: [],
        review: { basedOnWeekStart: "2026-08-31", observations: [], proposedChanges: [] },
      },
    });
    const week = plan({ id: "wk" });
    const dayPlan = plan({
      id: "dy", horizon: "day",
      payload: { horizon: "day", date: "2026-09-07", items: [] },
    });
    expect(openProposals([dayPlan, week, review]).map((p) => p.id)).toEqual(["sem", "wk", "dy"]);
  });

  it("asks the broadest question first, so a week is answered against a settled semester", () => {
    const semester = plan({
      id: "sem", horizon: "semester",
      payload: { horizon: "semester", summary: "", goals: [], milestones: [] },
    });
    expect(openProposals([plan({ id: "wk" }), semester]).map((p) => p.id)).toEqual(["sem", "wk"]);
  });

  it("says a Sunday proposal's week has already started", () => {
    // §5's persistence case: generated for the week of Sep 7, still unanswered
    // on Wednesday. The useful fact is not that it is late but that the week is.
    const wednesday = new Date(2026, 8, 9, 9, 0);
    expect(proposalStatusLine(plan(), wednesday)).toBe("Waiting on you — this week started 2 days ago.");
    expect(proposalStatusLine(plan(), MONDAY)).toBe("Waiting on you — this week starts today.");
    expect(proposalStatusLine(plan({ periodStart: "2026-09-08" }), MONDAY))
      .toBe("Waiting on you — this week starts tomorrow.");
  });
});

// ── The nudge ────────────────────────────────────────────────────────────────

describe("what the home screen surfaces", () => {
  const quiz = event({ id: "quiz", title: "MATH 221 — Quiz 3", kind: "exam", start: day(3, 9, 30).toISOString() });
  const project = event({ id: "project", start: day(3, 23, 59).toISOString() });
  const lecture = event({ id: "lecture", title: "CMSC 421 Lecture", kind: "class", start: day(1, 10).toISOString() });
  const distant = event({ id: "distant", start: day(20, 23, 59).toISOString() });

  it("finds the collision that makes the nudge worth reading", () => {
    expect(sameDayEvents([quiz, project, lecture], project).map((e) => e.id)).toEqual(["quiz"]);
  });

  it("ignores lectures and anything already done", () => {
    const done = event({ id: "done", start: day(3, 12).toISOString(), completedAt: day(0).toISOString() });
    expect(sameDayEvents([quiz, done, lecture], project).map((e) => e.id)).toEqual(["quiz"]);
  });

  it("takes the soonest two deadlines and stops", () => {
    const nudges = selectNudges({ now: MONDAY, tasks: [], events: [quiz, project, distant, lecture], plans: [] });
    expect(nudges.map((n) => n.key)).toEqual(["event:quiz", "event:project"]);
  });

  it("puts an unanswered proposal ahead of everything else", () => {
    const nudges = selectNudges({ now: MONDAY, tasks: [task()], events: [quiz], plans: [plan()] });
    expect(nudges[0]?.kind).toBe("proposal");
  });

  it("asks about the review when the semester plan carries one", () => {
    const review = plan({
      horizon: "semester",
      payload: {
        horizon: "semester", summary: "", goals: [], milestones: [],
        review: { basedOnWeekStart: "2026-08-31", observations: ["Four blocks moved to the morning."], proposedChanges: [] },
      },
    });
    const [first] = selectNudges({ now: MONDAY, tasks: [], events: [], plans: [review] });
    expect(first).toMatchObject({ kind: "review", basedOnWeekStart: "2026-08-31" });
  });

  it("falls back to today's outstanding work, and never overflows three rows", () => {
    const nudges = selectNudges({
      now: MONDAY, events: [], plans: [],
      tasks: [task({ id: "a" }), task({ id: "b" }), task({ id: "c", status: "done" }), task({ id: "d" })],
    });
    expect(nudges).toHaveLength(3);
    expect(nudges.map((n) => n.key)).toEqual(["task:a", "task:b", "task:d"]);
  });

  it("says when a deadline is due and when an exam simply is", () => {
    expect(eventWhenLine(project, MONDAY)).toMatch(/^Due Thursday at /);
    expect(eventWhenLine(quiz, MONDAY)).toMatch(/^Thursday at /);
  });

  it("places a same-day collision in the part of the day it lands", () => {
    expect(partOfDay(day(3, 9, 30).toISOString())).toBe("that morning");
    expect(partOfDay(day(3, 14).toISOString())).toBe("that afternoon");
    expect(partOfDay(day(3, 23, 59).toISOString())).toBe("that evening");
  });
});

// ── Amendments (contract D, POST /api/plan/:id/amend) ────────────────────────

describe("amendment payloads", () => {
  const item = { id: "w1", title: "Shell: pipe handling", kind: "homework" as const, estimatedMinutes: 90 };

  it("moves a block by naming only the buckets", () => {
    expect(rescheduleAmendment(item, "2026-09-07", "2026-09-08", "  too much on Monday  ")).toEqual({
      itemId: "w1", action: "rescheduled",
      before: { date: "2026-09-07" }, after: { date: "2026-09-08" },
      reason: "too much on Monday",
    });
  });

  it("resizes against the estimate it is replacing", () => {
    expect(resizeAmendment(item, 45)).toEqual({
      itemId: "w1", action: "resized",
      before: { estimatedMinutes: 90 }, after: { estimatedMinutes: 45 },
    });
  });

  it("carries the whole block when there is no 'after' to point at", () => {
    expect(removeAmendment(item, "2026-09-07")).toEqual({
      itemId: "w1", action: "removed", before: { date: "2026-09-07", item }, after: null,
    });
    expect(addAmendment(item, "2026-09-09")).toEqual({
      itemId: "w1", action: "added", before: null, after: { date: "2026-09-09", item },
    });
  });

  it("identifies a milestone by content, since contract B gives it no id", () => {
    expect(milestoneRescheduleAmendment({ title: "Project 1", targetDate: "2026-09-10" }, "2026-09-14")).toEqual({
      action: "rescheduled",
      before: { title: "Project 1", targetDate: "2026-09-10" },
      after: { title: "Project 1", targetDate: "2026-09-14" },
    });
  });

  it("omits a reason the student did not actually give", () => {
    expect(resizeAmendment(item, 45, "   ")).not.toHaveProperty("reason");
  });
});
