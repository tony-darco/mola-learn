"use client";

import { useState } from "react";
import type { TaskView } from "@mola/shared";
import { formatMinutes, summarizeTasks } from "./plan-logic";
import { ghostButton, input, primaryButton } from "./styles";

/**
 * The check-off list — the only surface on the Plan tab that is about doing
 * rather than deciding. Everything else here proposes; this one records.
 *
 * The parent owns the list so the optimistic flip and its rollback have one
 * home; this component only renders and reports intent.
 */
export function TodayTasks({
  tasks, now, courseLabel, relatedLabel, onToggle, onAdd, busy = false,
}: {
  tasks: TaskView[];
  now: Date;
  courseLabel: (courseId: string | null | undefined) => string | null;
  relatedLabel: (scheduleItemId: string | null | undefined) => string | null;
  onToggle: (task: TaskView, next: TaskView["status"]) => Promise<void>;
  onAdd: (task: { title: string; estimatedMinutes: number | null; courseId: string | null }) => Promise<void>;
  busy?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const { done, total, minutesLeft } = summarizeTasks(tasks);

  return (
    <div data-testid="today-tasks">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex items-baseline gap-2">
          <h2 className="m-0 text-base font-semibold text-fg">Today</h2>
          <span className="text-sm text-fg-muted">
            {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          </span>
        </div>
        {total > 0 && (
          <span className="text-sm text-fg-muted" data-testid="today-progress">
            {done} of {total} done{minutesLeft > 0 ? ` · ${formatMinutes(minutesLeft)} left` : ""}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        {tasks.length === 0 && !adding && (
          <p className="m-0 py-1 text-sm text-fg-muted">
            Nothing on today&rsquo;s list. Accept a plan below, or add something yourself.
          </p>
        )}

        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            course={courseLabel(task.courseId)}
            related={relatedLabel(task.scheduleItemId)}
            onToggle={onToggle}
            busy={busy}
          />
        ))}

        {adding ? (
          <AddTaskForm busy={busy} onCancel={() => setAdding(false)} onAdd={async (task) => {
            await onAdd(task);
            setAdding(false);
          }} />
        ) : (
          <button
            type="button"
            className={`${ghostButton} self-start`}
            onClick={() => setAdding(true)}
            disabled={busy}
            data-testid="today-add"
          >
            + Add a task
          </button>
        )}
      </div>
    </div>
  );
}

function TaskRow({
  task, course, related, onToggle, busy,
}: {
  task: TaskView;
  course: string | null;
  related: string | null;
  onToggle: (task: TaskView, next: TaskView["status"]) => Promise<void>;
  busy: boolean;
}) {
  const done = task.status === "done";

  return (
    <div
      className="flex items-start gap-2.5 rounded-lg border border-border bg-bg px-3 py-2"
      data-testid="task-row"
      data-status={task.status}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Mark ${task.title} not done` : `Mark ${task.title} done`}
        onClick={() => void onToggle(task, done ? "todo" : "done")}
        disabled={busy}
        data-testid="task-toggle"
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border disabled:cursor-default disabled:opacity-50 ${
          done ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface"
        }`}
      >
        {done && (
          <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 13l4 4L19 7" />
          </svg>
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`text-sm ${done ? "text-fg-muted line-through" : "text-fg"}`}>{task.title}</span>
          {course && <span className="text-xs text-fg-muted">{course}</span>}
          {task.estimatedMinutes ? (
            <span className="text-xs text-fg-muted">{formatMinutes(task.estimatedMinutes)}</span>
          ) : null}
        </div>
        {related && <div className="mt-0.5 text-xs text-fg-muted">{related}</div>}
        {task.notes && <div className="mt-0.5 text-xs text-fg-muted">{task.notes}</div>}
      </div>

      {!done && (
        <button
          type="button"
          className={ghostButton}
          onClick={() => void onToggle(task, "skipped")}
          disabled={busy}
          data-testid="task-skip"
        >
          Skip
        </button>
      )}
    </div>
  );
}

/**
 * Deliberately three fields. Anything the student needs a form for is a plan
 * amendment, not a task — this is for "oh, and email the TA".
 */
function AddTaskForm({
  busy, onAdd, onCancel,
}: {
  busy: boolean;
  onAdd: (task: { title: string; estimatedMinutes: number | null; courseId: string | null }) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [minutes, setMinutes] = useState(30);

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed) return;
    await onAdd({ title: trimmed, estimatedMinutes: minutes || null, courseId: null });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2">
      <input
        value={title}
        autoFocus
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); void submit(); }
          if (e.key === "Escape") onCancel();
        }}
        placeholder="What else are you doing today?"
        className={`${input} min-w-[200px] flex-1`}
        data-testid="add-task-title"
      />
      <input
        type="number"
        min={5}
        step={5}
        value={minutes || ""}
        onChange={(e) => setMinutes(Number(e.target.value))}
        className={`${input} w-20`}
        aria-label="Estimated minutes"
        data-testid="add-task-minutes"
      />
      <button type="button" className={primaryButton} onClick={() => void submit()} disabled={busy} data-testid="add-task-submit">
        Add
      </button>
      <button type="button" className={ghostButton} onClick={onCancel} disabled={busy}>Cancel</button>
    </div>
  );
}
