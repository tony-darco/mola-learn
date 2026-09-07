"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CalendarEvent, TaskView } from "@mola/shared";
import { planApi, type PlanApi } from "./api";
import { fixtureCourses, makeFixtureApi, type FixtureScenario } from "./fixtures";
import {
  addDays, localDayKey, makeCourseLabel, makeRelatedLabel, openProposals, parseDay, planReview,
  shortDate, tasksForToday,
  type CourseOption, type PlanAmendment, type PlanHorizon, type PlanRecord,
} from "./plan-logic";
import { DayPlan } from "./DayPlan";
import { PlanSection } from "./PlanSection";
import { SemesterPlan } from "./SemesterPlan";
import { TodayTasks } from "./TodayTasks";
import { WeekPlan } from "./WeekPlan";
import { card, secondaryButton } from "./styles";

/** How far ahead the page needs real dates for: far enough that a semester
 * milestone can name the exam it points at, not so far that the fetch is a
 * calendar dump. */
const EVENT_WINDOW_DAYS = 60;

type Plans = { day: PlanRecord | null; week: PlanRecord | null; semester: PlanRecord | null };

export function PlanTab({
  courses, fixtures = null,
}: {
  courses: CourseOption[];
  /** Dev-only, set from `?fixtures=` by the page. Null everywhere else, which
   * is every path a student can reach. */
  fixtures?: FixtureScenario | null;
}) {
  const courseList = fixtures ? fixtureCourses(courses) : courses;
  const api: PlanApi = useMemo(
    () => (fixtures ? makeFixtureApi(fixtureCourses(courses), fixtures) : planApi),
    [fixtures, courses],
  );

  // `now` is set once the load resolves rather than at first render: a client
  // component still renders on the server, and a date formatted there against
  // the server's locale is a hydration mismatch waiting to happen.
  const [now, setNow] = useState<Date | null>(null);
  const [plans, setPlans] = useState<Plans>({ day: null, week: null, semester: null });
  const [tasks, setTasks] = useState<TaskView[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [partial, setPartial] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const at = new Date();
    const today = localDayKey(at);

    void Promise.allSettled([
      api.fetchPlan("day", today),
      api.fetchPlan("week"),
      api.fetchPlan("semester"),
      api.fetchTasks({ date: today }),
      api.fetchEvents(addDays(at, -1), addDays(at, EVENT_WINDOW_DAYS)),
    ]).then((results) => {
      if (cancelled) return;
      const [day, week, semester, taskList, eventList] = results;
      setPlans({
        day: value(day, null), week: value(week, null), semester: value(semester, null),
      });
      setTasks(value(taskList, []));
      setEvents(value(eventList, []));
      setPartial(results.some((r) => r.status === "rejected"));
      setNow(at);
    });

    return () => { cancelled = true; };
  }, [api]);

  const refreshTasks = useCallback(async () => {
    const list = await api.fetchTasks({ date: localDayKey(new Date()) }).catch(() => null);
    if (list) setTasks(list);
  }, [api]);

  function store(plan: PlanRecord) {
    setPlans((prev) => ({ ...prev, [plan.horizon]: plan }));
  }

  async function run(work: () => Promise<void>, failure: string) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await work();
    } catch {
      setNotice(failure);
    } finally {
      setBusy(false);
    }
  }

  const propose = (horizon: PlanHorizon) => run(async () => {
    const plan = await api.proposePlan(horizon, horizon === "day" ? localDayKey(new Date()) : undefined);
    if (plan) store(plan);
    else setNotice("Working on that plan now. Reload in a moment to see it.");
  }, "Could not ask for a plan just now. Try again in a moment.");

  const accept = (plan: PlanRecord) => run(async () => {
    store(await api.acceptPlan(plan.id));
    // Accept materialises the payload's blocks into tasks (contract D), so
    // today's list is stale the instant a plan is agreed to.
    await refreshTasks();
  }, "Could not accept that plan. Nothing was changed.");

  const amend = (plan: PlanRecord) => async (amendments: PlanAmendment[]) => {
    await run(async () => {
      store(await api.amendPlan(plan.id, amendments));
      await refreshTasks();
    }, "Could not save that change. Nothing was changed.");
  };

  /** Optimistic, because a checkbox that waits on a round trip feels broken —
   * and reverted on failure, because one that lies is worse. */
  async function toggleTask(task: TaskView, next: TaskView["status"]) {
    const before = task.status;
    setTasks((list) => list.map((t) => (t.id === task.id ? { ...t, status: next } : t)));
    setNotice(null);
    try {
      const saved = await api.patchTask(task.id, { status: next });
      setTasks((list) => list.map((t) => (t.id === saved.id ? saved : t)));
    } catch {
      setTasks((list) => list.map((t) => (t.id === task.id ? { ...t, status: before } : t)));
      setNotice("That did not save — put back the way it was.");
    }
  }

  async function addTask(input: { title: string; estimatedMinutes: number | null; courseId: string | null }) {
    await run(async () => {
      const task = await api.createTask({ ...input, scheduledFor: new Date().toISOString() });
      setTasks((list) => [...list, task]);
    }, "Could not add that task.");
  }

  if (!now) return <LoadingState />;

  const at = now;
  const courseLabel = makeCourseLabel(courseList);
  const relatedLabel = makeRelatedLabel(events, at);
  const proposals = openProposals([plans.semester, plans.week, plans.day]);
  const hoisted = new Set(proposals.map((p) => p.id));
  const todaysTasks = tasksForToday(tasks, at);

  /** One plan, whichever horizon it is — used both hoisted and in place, so a
   * proposal and the commitment it becomes are visibly the same object. */
  function section(plan: PlanRecord, lead: boolean) {
    const review = planReview(plan);
    const onAmend = amend(plan);
    const gate = {
      plan, now: at, lead, busy,
      onAccept: () => accept(plan),
      onPropose: () => propose(plan.horizon),
    };

    if (plan.payload.horizon === "day") {
      return (
        <PlanSection
          key={plan.id}
          {...gate}
          title="A plan for today"
          subtitle={parseDay(plan.payload.date).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          emptyLine="No plan for today yet."
          proposeLabel="Plan my day"
          acceptLabel="Accept today's plan"
        >
          <DayPlan
            payload={plan.payload}
            courseLabel={courseLabel}
            relatedLabel={relatedLabel}
            onAmend={onAmend}
            busy={busy}
          />
        </PlanSection>
      );
    }

    if (plan.payload.horizon === "week") {
      const start = parseDay(plan.payload.weekStart);
      return (
        <PlanSection
          key={plan.id}
          {...gate}
          title="This week"
          subtitle={`${shortDate(start)} – ${shortDate(addDays(start, 6))}`}
          emptyLine="No plan for this week yet."
          proposeLabel="Propose a week plan"
          acceptLabel="Accept this week"
        >
          <WeekPlan
            payload={plan.payload}
            now={at}
            courseLabel={courseLabel}
            relatedLabel={relatedLabel}
            onAmend={onAmend}
            busy={busy}
          />
        </PlanSection>
      );
    }

    return (
      <PlanSection
        key={plan.id}
        {...gate}
        // The review block below names the week it read; saying it twice in
        // two type sizes reads like a template, not a conversation.
        title={review ? "Last week, and what it changes" : "The semester"}
        emptyLine="No semester plan yet."
        proposeLabel="Propose a semester plan"
        acceptLabel={review ? "Accept these changes" : "Accept this plan"}
      >
        <SemesterPlan
          payload={plan.payload}
          now={at}
          courseLabel={courseLabel}
          onAmend={onAmend}
          busy={busy}
        />
      </PlanSection>
    );
  }

  return (
    <main className="flex-1 min-w-0 overflow-y-auto py-8 pl-4 pr-6">
      <div className="mx-auto max-w-7xl">
        <h1 className="mb-1 text-3xl font-semibold text-fg">Plan</h1>
        <p className="mb-6 mt-0 max-w-2xl text-sm text-fg-muted">
          The semester sets the direction, the week is what you have committed to, and today is what
          you actually sit down and do.
        </p>

        {partial && (
          <p className="mb-4 text-sm text-fg-muted" data-testid="plan-partial">
            Some of this could not be loaded. What is here is real; reload to try for the rest.
          </p>
        )}
        {notice && (
          <p className="mb-4 text-sm text-fg" data-testid="plan-notice">{notice}</p>
        )}

        {/* §5: a proposal nobody answered on Sunday is still the first thing
            the student sees on Wednesday. Every open one leads the page. */}
        {proposals.length > 0 && (
          <div className="mb-6 flex flex-col gap-4" data-testid="plan-proposals">
            {proposals.map((plan, i) => section(plan, i === 0))}
          </div>
        )}

        <div className={`grid grid-cols-1 items-start gap-6 ${aside ? "lg:grid-cols-[minmax(0,1fr)_420px]" : ""}`}>
          <div className="flex flex-col gap-4">
            <div className={card}>
              <TodayTasks
                tasks={todaysTasks}
                now={at}
                courseLabel={courseLabel}
                relatedLabel={relatedLabel}
                onToggle={toggleTask}
                onAdd={addTask}
                busy={busy}
              />
              {!plans.day && (
                <div className="mt-3 border-t border-border pt-3">
                  <button
                    type="button"
                    className={secondaryButton}
                    onClick={() => void propose("day")}
                    disabled={busy}
                    data-testid="propose-day"
                  >
                    Plan my day
                  </button>
                </div>
              )}
            </div>

            {plans.week === null && (
              <EmptyPlan
                title="This week"
                line="No plan for this week yet."
                label="Propose a week plan"
                onPropose={() => propose("week")}
                busy={busy}
                testid="propose-week"
              />
            )}
            {plans.week !== null && !hoisted.has(plans.week.id) && section(plans.week, false)}
          </div>

          {aside && <div className="flex flex-col gap-4">{aside}</div>}
        </div>
      </div>
    </main>
  );
}

function EmptyPlan({
  title, line, label, onPropose, busy, testid,
}: {
  title: string; line: string; label: string; onPropose: () => Promise<void>; busy: boolean; testid: string;
}) {
  return (
    <section className={card} data-testid="plan-section" data-awaiting="false">
      <h2 className="m-0 mb-2 text-base font-semibold text-fg">{title}</h2>
      <p className="m-0 mb-2 text-sm text-fg-muted">{line}</p>
      <button type="button" className={secondaryButton} onClick={() => void onPropose()} disabled={busy} data-testid={testid}>
        {label}
      </button>
    </section>
  );
}

function LoadingState() {
  return (
    <main className="flex-1 min-w-0 overflow-y-auto py-8 pl-4 pr-6">
      <div className="mx-auto max-w-7xl">
        <h1 className="mb-1 text-3xl font-semibold text-fg">Plan</h1>
        <p className="mt-0 text-sm text-fg-muted">Loading…</p>
      </div>
    </main>
  );
}

function value<T>(result: PromiseSettledResult<T>, fallback: T): T {
  return result.status === "fulfilled" ? result.value : fallback;
}
