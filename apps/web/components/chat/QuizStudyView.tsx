"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { z } from "zod";
import type { quizQuestionSchema } from "@mola/shared";
import { submitQuizAttemptAction, updateQuizQuestionsAction, type QuestionInput } from "@/lib/quizzes/actions";
import { renameArtifactAction } from "@/lib/artifacts/rename";
import { Markdown } from "./Markdown";

type Question = z.infer<typeof quizQuestionSchema>;
type Mode = "take" | "edit";

/**
 * Canvas/Blackboard-style quiz page: numbered questions in a single
 * scrollable list, radio-button options, a Submit at the bottom — the
 * reference the student described, not the Quizlet card-flip style
 * FlashcardStudyView uses (a quiz and a deck are different studying tasks).
 * Own dedicated page (app/(shell)/quizzes/[quizId]), sidebar stays visible,
 * same as the flashcard deck page.
 */
export function QuizStudyView({
  quizId, title: initialTitle, courseId, questions: initialQuestions,
}: { quizId: string; title: string; courseId: string | null; questions: Question[] }) {
  const [mode, setMode] = useState<Mode>("take");
  const [title, setTitle] = useState(initialTitle);
  const [editingTitle, setEditingTitle] = useState(false);
  const [questions, setQuestions] = useState<Question[]>(initialQuestions);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<{ score: number; total: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  function commitTitle() {
    setEditingTitle(false);
    const trimmed = title.trim();
    if (!trimmed) { setTitle(initialTitle); return; }
    if (trimmed === initialTitle) return;
    void renameArtifactAction(quizId, trimmed, "quiz", "/quizzes");
  }

  async function submit() {
    setSubmitting(true);
    try {
      const { score, total } = await submitQuizAttemptAction(quizId, answers);
      setResult({ score, total });
    } finally {
      setSubmitting(false);
    }
  }

  function retake() {
    setAnswers({});
    setResult(null);
  }

  /** Seeds a new chat with the attempt's score and missed questions via the
   * existing ?draft= handoff (same mechanism NewCourseChatComposer uses),
   * so the model can run a real Socratic review of THIS attempt. */
  async function reviewWithChat() {
    if (!result) return;
    const missed = questions
      .filter((q) => q.type === "multiple_choice" && answers[q.id] !== q.correctIndex)
      .map((q) => q.prompt);

    const summary = missed.length === 0
      ? `I just took the quiz "${title}" and got a perfect score (${result.score}/${result.total}). Can you go over the trickiest ideas from it with me anyway, so they stick?`
      : `I just took the quiz "${title}" and scored ${result.score}/${result.total}. I missed these questions:\n` +
        missed.map((p, i) => `${i + 1}. ${p}`).join("\n") +
        `\n\nCan you help me understand what I got wrong and review the underlying concepts?`;

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(courseId ? { courseId } : {}),
    });
    if (!res.ok) return;
    const { id } = (await res.json()) as { id: string };
    router.push(`/chats/${id}?draft=${encodeURIComponent(summary)}`);
  }

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        {editingTitle ? (
          <input
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
              if (e.key === "Escape") { e.preventDefault(); setTitle(initialTitle); setEditingTitle(false); }
            }}
            aria-label="Quiz title"
            className="w-full rounded-lg border border-border bg-bg px-2 py-1 text-2xl font-semibold text-fg focus:outline-none"
          />
        ) : (
          <h1
            className="cursor-text rounded-lg px-2 py-1 text-2xl font-semibold text-fg hover:bg-surface"
            onClick={() => setEditingTitle(true)}
            title="Click to rename"
          >
            {title}
          </h1>
        )}

        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => setMode("take")}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${mode === "take" ? "bg-accent text-accent-fg" : "bg-surface text-fg hover:opacity-90"}`}
          >
            Take
          </button>
          <button
            type="button"
            onClick={() => setMode("edit")}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${mode === "edit" ? "bg-accent text-accent-fg" : "bg-surface text-fg hover:opacity-90"}`}
          >
            Edit
          </button>
        </div>
      </div>

      {mode === "edit" ? (
        <QuizEditor
          quizId={quizId}
          questions={questions}
          onSaved={(next) => { setQuestions(next); setAnswers({}); setResult(null); }}
        />
      ) : result ? (
        <div className="rounded-xl border border-border bg-surface p-8 text-center">
          <div className="text-sm text-fg-muted">Score</div>
          <div className="mt-1 text-4xl font-semibold text-fg">{result.score} / {result.total}</div>
          <div className="mt-6 flex justify-center gap-2">
            <button type="button" onClick={retake} className="rounded-lg border border-border bg-bg px-4 py-2 text-sm font-medium text-fg hover:bg-surface">
              Retake
            </button>
            <button type="button" onClick={() => void reviewWithChat()} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg hover:opacity-90">
              Review with chat
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="mb-4 rounded-lg border border-border bg-surface px-4 py-2 text-xs text-fg-muted">
            {Object.keys(answers).length} of {questions.length} answered
          </div>
          {questions.map((q, i) => (
            <QuestionCard
              key={q.id}
              index={i + 1}
              question={q}
              selected={answers[q.id] ?? null}
              onSelect={(idx) => setAnswers((a) => ({ ...a, [q.id]: idx }))}
            />
          ))}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting || questions.length === 0}
            className="mt-2 w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-fg disabled:opacity-50"
          >
            {submitting ? "Grading…" : "Submit quiz"}
          </button>
        </div>
      )}
    </div>
  );
}

function QuestionCard({
  index, question, selected, onSelect,
}: { index: number; question: Question; selected: number | null; onSelect: (i: number) => void }) {
  return (
    <div className="mb-4 rounded-xl border border-border bg-surface p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="font-medium text-fg"><span className="text-fg-muted">{index}.</span> <Markdown text={question.prompt} /></div>
        <div className="shrink-0 text-xs text-fg-muted">1 pt</div>
      </div>

      {question.type === "multiple_choice" ? (
        <div className="flex flex-col gap-2">
          {question.options.map((opt, i) => (
            <label
              key={i}
              className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 ${
                selected === i ? "border-accent bg-accent/10" : "border-border bg-bg hover:bg-surface"
              }`}
            >
              <input
                type="radio"
                name={question.id}
                checked={selected === i}
                onChange={() => onSelect(i)}
                className="accent-accent"
              />
              <span className="text-sm text-fg">{opt}</span>
            </label>
          ))}
        </div>
      ) : (
        <div className="text-xs text-fg-muted">Short-answer — not scored automatically. Discuss with Mola after submitting.</div>
      )}
    </div>
  );
}

// ── Edit mode ────────────────────────────────────────────────────────────────

type Row = QuestionInput & { key: string };

function toRows(questions: Question[]): Row[] {
  return questions.map((q) =>
    q.type === "multiple_choice"
      ? { key: q.id, id: q.id, type: "multiple_choice", prompt: q.prompt, options: [...q.options], correctIndex: q.correctIndex, explanation: q.explanation }
      : { key: q.id, id: q.id, type: "short_answer", prompt: q.prompt, expectedAnswer: q.expectedAnswer, explanation: q.explanation },
  );
}

function QuizEditor({
  quizId, questions, onSaved,
}: { quizId: string; questions: Question[]; onSaved: (q: Question[]) => void }) {
  const [rows, setRows] = useState<Row[]>(() => toRows(questions));
  const [saving, setSaving] = useState(false);
  const dragIndex = useRef<number | null>(null);

  async function save(next: Row[]) {
    setRows(next);
    setSaving(true);
    try {
      await updateQuizQuestionsAction(quizId, next);
      // The server minted ids for any brand-new rows — refetch isn't available
      // here (this is a client component with no loader), so we optimistically
      // keep the rows as-is; a page revalidation (revalidatePath) catches up
      // the canonical ids on next load. onSaved only needs the shape for the
      // Take-mode reset, not exact new ids.
      onSaved(next.filter((r) => r.prompt.trim()) as unknown as Question[]);
    } finally {
      setSaving(false);
    }
  }

  function updateRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, k) => (k === i ? ({ ...r, ...patch } as Row) : r)));
  }

  function addRow() {
    setRows((rs) => [...rs, { key: `new-${Date.now()}`, type: "multiple_choice", prompt: "", options: ["", ""], correctIndex: 0, explanation: null }]);
  }

  function removeRow(i: number) {
    void save(rows.filter((_, k) => k !== i));
  }

  function onDrop(target: number) {
    const from = dragIndex.current;
    dragIndex.current = null;
    if (from === null || from === target) return;
    const next = [...rows];
    const [moved] = next.splice(from, 1);
    next.splice(target, 0, moved!);
    void save(next);
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm text-fg-muted">
          {rows.length} {rows.length === 1 ? "question" : "questions"} · drag to reorder, changes save as you go
        </div>
        {saving && <div className="text-xs text-fg-muted">Saving…</div>}
      </div>

      <div className="flex flex-col gap-3">
        {rows.map((row, i) => (
          <div
            key={row.key}
            draggable
            onDragStart={() => { dragIndex.current = i; }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onDrop(i)}
            className="rounded-xl border border-border bg-surface p-3"
          >
            <div className="mb-2 flex items-start gap-2">
              <span className="mt-2 cursor-grab text-fg-muted active:cursor-grabbing" aria-hidden="true" title="Drag to reorder">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <circle cx="9" cy="6" r="1" /><circle cx="15" cy="6" r="1" />
                  <circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" />
                  <circle cx="9" cy="18" r="1" /><circle cx="15" cy="18" r="1" />
                </svg>
              </span>
              <div className="flex-1">
                <span className="text-xs uppercase tracking-wide text-fg-muted">Question</span>
                <AutoGrowTextarea value={row.prompt} onChange={(v) => updateRow(i, { prompt: v })} onBlur={() => void save(rows)} />
              </div>
              <button
                type="button"
                onClick={() => removeRow(i)}
                title="Remove question"
                aria-label="Remove question"
                className="mt-1 rounded-md p-1.5 text-fg-muted hover:bg-bg hover:text-fg"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            {row.type === "multiple_choice" ? (
              <div className="ml-6 flex flex-col gap-1.5">
                {row.options.map((opt, oi) => (
                  <div key={oi} className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={row.correctIndex === oi}
                      // Not updateRow (setRows only) — this must commit
                      // immediately like add/remove/reorder do, since there's
                      // no blur event on a radio to hang a save off of.
                      // Confirmed live: without this, marking a different
                      // option correct silently never persisted.
                      onChange={() => void save(rows.map((r, k) => (k === i ? { ...r, correctIndex: oi } : r)))}
                      title="Mark as correct answer"
                      className="accent-accent"
                    />
                    <input
                      value={opt}
                      onChange={(e) => updateRow(i, { options: row.options.map((o, k) => (k === oi ? e.target.value : o)) })}
                      onBlur={() => void save(rows)}
                      placeholder={`Option ${oi + 1}`}
                      className="flex-1 rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm text-fg focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => void save(rows.map((r, k) => k === i && r.type === "multiple_choice"
                        ? { ...r, options: r.options.filter((_, oidx) => oidx !== oi), correctIndex: r.correctIndex >= oi ? Math.max(0, r.correctIndex - 1) : r.correctIndex }
                        : r))}
                      disabled={row.options.length <= 2}
                      title="Remove option"
                      aria-label="Remove option"
                      className="rounded-md px-1.5 py-1 text-fg-muted hover:bg-bg hover:text-fg disabled:opacity-30"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => updateRow(i, { options: [...row.options, ""] })}
                  disabled={row.options.length >= 6}
                  className="self-start text-xs text-fg-muted hover:text-fg disabled:opacity-30"
                >
                  + Add option
                </button>
              </div>
            ) : (
              <div className="ml-6">
                <span className="text-xs uppercase tracking-wide text-fg-muted">Expected answer</span>
                <AutoGrowTextarea value={row.expectedAnswer} onChange={(v) => updateRow(i, { expectedAnswer: v })} onBlur={() => void save(rows)} />
              </div>
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addRow}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border py-3 text-sm text-fg-muted hover:border-accent hover:text-fg"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        Add question
      </button>
    </div>
  );
}

/** Sizes itself to its content — same fix as the flashcard editor's fields. */
function AutoGrowTextarea({
  value, onChange, onBlur,
}: { value: string; onChange: (v: string) => void; onBlur: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      rows={1}
      className="w-full resize-none overflow-hidden rounded-lg border border-border bg-bg px-2.5 py-2 text-sm text-fg focus:outline-none"
    />
  );
}
