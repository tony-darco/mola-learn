"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CalendarEvent, TaskView } from "@mola/shared";
import { planApi, type PlanApi } from "@/components/plan/api";
import { fixtureCourses, makeFixtureApi, type FixtureScenario } from "@/components/plan/fixtures";
import {
  NUDGE_HORIZON_DAYS, addDays, describeWhen, eventWhenLine, formatMinutes, localDayKey, partOfDay,
  selectNudges, type CourseOption, type Nudge, type PlanRecord,
} from "@/components/plan/plan-logic";
import { ghostButton } from "@/components/plan/styles";

/**
 * The nudge above the composer: what is coming, and one concrete thing to do
 * about it. Deliberately capped at three rows and silent when it has nothing
 * to say — it sits above a composer on the landing screen, so anything that
 * reads as a dashboard has taken space from the thing the student came for.
 *
 * Every action here lands on a surface that already exists: a course-scoped
 * chat (which is also how a practice quiz gets made — `create_quiz` is a tool
 * on that agent), the decks and quizzes galleries, or the Plan tab.
 */
export function NextUpPanel({
  courses = [], fixtures = null,
}: {
  courses?: CourseOption[];
  /** Dev-only, from `?fixtures=` on the landing page. */
  fixtures?: FixtureScenario | null;
}) {
  const router = useRouter();
  const api: PlanApi = useMemo(
    () => (fixtures ? makeFixtureApi(fixtureCourses(courses), fixtures) : planApi),
    [fixtures, courses],
  );

  const [nudges, setNudges] = useState<Nudge[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const now = new Date();

    void Promise.allSettled([
      api.fetchTasks({ date: localDayKey(now), status: "todo" }),
      api.fetchEvents(now, addDays(now, NUDGE_HORIZON_DAYS + 1)),
      api.fetchPlan("day", localDayKey(now)),
      api.fetchPlan("week"),
      api.fetchPlan("semester"),
    ]).then(([tasks, events, day, week, semester]) => {
      if (cancelled) return;
      setNudges(selectNudges({
        now,
        tasks: settled<TaskView[]>(tasks, []),
        events: settled<CalendarEvent[]>(events, []),
        plans: [settled(day, null), settled(week, null), settled(semester, null)],
      }));
    });

    return () => { cancelled = true; };
  }, [api]);

  async function startChat(courseId: string | null, draft: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ courseId }),
      });
      if (!res.ok) throw new Error(`failed to create chat (${res.status})`);
      const { id } = (await res.json()) as { id: string };
      router.push(`/chats/${id}?draft=${encodeURIComponent(draft)}`);
    } catch {
      setBusy(false);
    }
  }

  /** Optimistic and quiet: the row leaves the panel, and comes back if the
   * write failed. Nothing else on this screen is worth an error banner. */
  async function checkOff(task: TaskView) {
    const before = nudges;
    setNudges((list) => (list ?? []).filter((n) => !(n.kind === "task" && n.task.id === task.id)));
    try {
      await api.patchTask(task.id, { status: "done" });
    } catch {
      setNudges(before);
    }
  }

  if (!nudges || nudges.length === 0) return null;

  return (
    <div className="mb-4 rounded-xl border border-border bg-surface px-4 py-3" data-testid="next-up">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">Next up</div>
      <div className="flex flex-col divide-y divide-border">
        {nudges.map((nudge) => (
          <NudgeRow key={nudge.key} nudge={nudge} busy={busy} onStartChat={startChat} onCheckOff={checkOff} />
        ))}
      </div>
    </div>
  );
}

function NudgeRow({
  nudge, busy, onStartChat, onCheckOff,
}: {
  nudge: Nudge;
  busy: boolean;
  onStartChat: (courseId: string | null, draft: string) => Promise<void>;
  onCheckOff: (task: TaskView) => Promise<void>;
}) {
  const now = new Date();

  if (nudge.kind === "review") {
    return (
      <Row
        title="You haven't looked back at last week yet"
        detail={nudge.observations[0] ?? `Based on the week of ${describeWhen(nudge.basedOnWeekStart, now)}.`}
        testid="nudge-review"
      >
        <PlanLink label="Review it" />
      </Row>
    );
  }

  if (nudge.kind === "proposal") {
    return (
      <Row
        title={`There is a ${PERIOD[nudge.plan.horizon]} plan waiting on you`}
        detail="Nothing happens with it until you accept or change it."
        testid="nudge-proposal"
      >
        <PlanLink label="Look at it" />
      </Row>
    );
  }

  if (nudge.kind === "event") {
    const { event, alsoThatDay } = nudge;
    const collision = alsoThatDay[0];
    const exam = event.kind === "exam";
    return (
      <Row
        title={event.title}
        detail={
          collision
            ? `${eventWhenLine(event, now)} — and ${collision.title} ${partOfDay(collision.start)}.`
            : eventWhenLine(event, now)
        }
        testid="nudge-event"
      >
        <button
          type="button"
          className={ghostButton}
          disabled={busy}
          data-testid="nudge-start-chat"
          onClick={() => void onStartChat(
            event.courseId,
            exam
              ? `${event.title} is ${describeWhen(new Date(event.start), now)}. Make me a practice quiz on the material it covers.`
              : `I want to work on ${event.title}, ${eventWhenLine(event, now).toLowerCase()}. Where should I start?`,
          )}
        >
          {exam ? "Make a practice quiz" : "Work on it"}
        </button>
        {exam
          ? <GalleryLink href="/flashcards" label="My flashcards" />
          : <PlanLink label="Open plan" />}
      </Row>
    );
  }

  const { task } = nudge;
  return (
    <Row
      title={task.title}
      detail={task.estimatedMinutes ? `On today's list · ${formatMinutes(task.estimatedMinutes)}` : "On today's list"}
      testid="nudge-task"
    >
      <button
        type="button"
        className={ghostButton}
        disabled={busy}
        data-testid="nudge-check-off"
        onClick={() => void onCheckOff(task)}
      >
        Check it off
      </button>
      <button
        type="button"
        className={ghostButton}
        disabled={busy}
        data-testid="nudge-start-chat"
        onClick={() => void onStartChat(task.courseId, `I'm working on: ${task.title}. Help me get started.`)}
      >
        Work on it
      </button>
    </Row>
  );
}

const PERIOD: Record<PlanRecord["horizon"], string> = { day: "day", week: "week", semester: "semester" };

function Row({
  title, detail, testid, children,
}: {
  title: string; detail: string; testid: string; children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2" data-testid={testid}>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-fg">{title}</div>
        <div className="text-xs text-fg-muted">{detail}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1">{children}</div>
    </div>
  );
}

function PlanLink({ label }: { label: string }) {
  return (
    <Link href="/plan" className={`${ghostButton} no-underline`} data-testid="nudge-open-plan">
      {label}
    </Link>
  );
}

function GalleryLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className={`${ghostButton} no-underline`} data-testid="nudge-open-gallery">
      {label}
    </Link>
  );
}

function settled<T>(result: PromiseSettledResult<T>, fallback: T): T {
  return result.status === "fulfilled" ? result.value : fallback;
}
