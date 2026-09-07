"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ArtifactRecord } from "@mola/shared";
import type { CourseOption, TermOption } from "@/lib/quizzes/gallery";
import { renameArtifactAction } from "@/lib/artifacts/rename";
import { artifactIcon, summarizeArtifact } from "./artifact-summary";

/** `ArtifactRecord` with dates as the ISO strings the server page sends over the RSC boundary. */
type ClientQuiz = Omit<ArtifactRecord, "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string };

const selectClass =
  "rounded-lg border border-border bg-bg px-2.5 py-2 text-sm text-fg focus:outline-none";

type SortKey = "modified" | "created" | "title";
const NO_COURSE = "__none__";

function relativeDate(iso: string): string {
  const date = new Date(iso);
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * The Quizzes gallery — identical structure to FlashcardsGallery.tsx (same
 * filter/sort/search, same right-click-inline-rename), scoped to kind='quiz'.
 * Kept as its own component rather than a shared generic one: the preview
 * (question prompts, not card fronts) and the summary line differ enough,
 * and each gallery is small enough that the duplication is cheaper to read
 * than a generalized abstraction over two artifact kinds.
 */
export function QuizzesGallery({
  quizzes: serverQuizzes, courses, terms,
}: { quizzes: ClientQuiz[]; courses: CourseOption[]; terms: TermOption[] }) {
  const [search, setSearch] = useState("");
  const [courseFilter, setCourseFilter] = useState("all");
  const [textbookFilter, setTextbookFilter] = useState("all");
  const [termFilter, setTermFilter] = useState("all");
  const [sortBy, setSortBy] = useState<SortKey>("modified");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamed, setRenamed] = useState<Record<string, string>>({});
  const router = useRouter();

  const quizzes = useMemo(
    () => serverQuizzes.map((q) => (renamed[q.id] ? { ...q, title: renamed[q.id]! } : q)),
    [serverQuizzes, renamed],
  );

  /** Commits an inline rename. Saved on blur — same as the deck page's title. */
  async function rename(quizId: string, next: string, current: string) {
    setRenamingId(null);
    const trimmed = next.trim();
    if (!trimmed || trimmed === current) return;
    setRenamed((r) => ({ ...r, [quizId]: trimmed }));
    await renameArtifactAction(quizId, trimmed, "quiz", "/quizzes");
    router.refresh();
  }

  const courseMap = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);

  const textbookOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const q of quizzes) for (const s of q.sources) map.set(s.documentId, s.documentTitle);
    return [...map.entries()];
  }, [quizzes]);

  function courseLabel(courseId: string | null): string | null {
    if (!courseId) return null;
    const c = courseMap.get(courseId);
    if (!c) return null;
    return c.number ? `${c.number} — ${c.name}` : c.name;
  }

  function termIdForQuiz(courseId: string | null): string | null {
    if (!courseId) return null;
    return courseMap.get(courseId)?.termId ?? null;
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = quizzes.filter((item) => {
      if (courseFilter === NO_COURSE && item.courseId !== null) return false;
      if (courseFilter !== "all" && courseFilter !== NO_COURSE && item.courseId !== courseFilter) return false;

      if (textbookFilter !== "all" && !item.sources.some((s) => s.documentId === textbookFilter)) return false;

      if (termFilter !== "all") {
        const termId = termIdForQuiz(item.courseId);
        if (termFilter === NO_COURSE && termId !== null) return false;
        if (termFilter !== NO_COURSE && termId !== termFilter) return false;
      }

      if (q) {
        const inTitle = item.title.toLowerCase().includes(q);
        const inTopics = item.topics.some((t) => t.toLowerCase().includes(q));
        const inSources = item.sources.some((s) => s.documentTitle.toLowerCase().includes(q));
        if (!inTitle && !inTopics && !inSources) return false;
      }
      return true;
    });

    return [...list].sort((a, b) => {
      if (sortBy === "title") return a.title.localeCompare(b.title);
      if (sortBy === "created") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quizzes, courseFilter, textbookFilter, termFilter, search, sortBy, courseMap]);

  return (
    <div>
      <h1 className="mb-4 text-3xl font-semibold text-fg">Quizzes</h1>

      <div className="mb-4 flex gap-4 border-b border-border">
        <div className="border-b-2 border-accent px-1 pb-2 text-sm font-medium text-fg">All quizzes</div>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <svg
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted"
            fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
          >
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search quizzes…"
            className="w-full rounded-lg border border-border bg-bg py-2 pl-8 pr-3 text-sm text-fg placeholder:text-fg-muted focus:outline-none"
          />
        </div>

        <select value={courseFilter} onChange={(e) => setCourseFilter(e.target.value)} className={selectClass} aria-label="Filter by course">
          <option value="all">All courses</option>
          <option value={NO_COURSE}>No course</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>{c.number ? `${c.number} — ${c.name}` : c.name}</option>
          ))}
        </select>

        <select value={textbookFilter} onChange={(e) => setTextbookFilter(e.target.value)} className={selectClass} aria-label="Filter by textbook">
          <option value="all">All textbooks</option>
          {textbookOptions.map(([id, title]) => (
            <option key={id} value={id}>{title}</option>
          ))}
        </select>

        <select value={termFilter} onChange={(e) => setTermFilter(e.target.value)} className={selectClass} aria-label="Filter by semester">
          <option value="all">All semesters</option>
          <option value={NO_COURSE}>No semester</option>
          {terms.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>

        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)} className={selectClass} aria-label="Sort by">
          <option value="modified">Last edited</option>
          <option value="created">Date created</option>
          <option value="title">Title</option>
        </select>
      </div>

      {quizzes.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-10 text-center text-sm text-fg-muted">
          No quizzes yet — ask Mola to make one from a chat.
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-10 text-center text-sm text-fg-muted">
          No quizzes match your filters.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((item) => (
            <QuizCard
              key={item.id}
              quiz={item}
              courseLabel={courseLabel(item.courseId)}
              renaming={renamingId === item.id}
              onStartRename={() => setRenamingId(item.id)}
              onCommitRename={(next) => void rename(item.id, next, item.title)}
              onCancelRename={() => setRenamingId(null)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function QuizCard({
  quiz, courseLabel, renaming, onStartRename, onCommitRename, onCancelRename,
}: {
  quiz: ClientQuiz;
  courseLabel: string | null;
  renaming: boolean;
  onStartRename: () => void;
  onCommitRename: (next: string) => void;
  onCancelRename: () => void;
}) {
  const questions = quiz.payload.kind === "quiz" ? quiz.payload.questions : [];
  const preview = questions.slice(0, 3).map((q) => q.prompt);
  const [draft, setDraft] = useState(quiz.title);

  const body = (
    <>
      <div className="flex h-28 flex-col justify-center gap-1 overflow-hidden bg-bg px-4 py-3">
        {preview.length === 0 ? (
          <span className="text-2xl text-fg-muted" aria-hidden="true">{artifactIcon(quiz.payload.kind)}</span>
        ) : (
          preview.map((prompt, i) => (
            <div key={i} className="truncate text-xs text-fg-muted">{prompt}</div>
          ))
        )}
      </div>
      <div className="flex flex-col gap-1 border-t border-border p-3">
        {renaming ? (
          <input
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => onCommitRename(draft)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
              if (e.key === "Escape") { e.preventDefault(); setDraft(quiz.title); onCancelRename(); }
            }}
            aria-label="Quiz title"
            className="w-full rounded-md border border-border bg-bg px-1.5 py-0.5 text-sm font-semibold text-fg focus:outline-none"
          />
        ) : (
          <div className="truncate text-sm font-semibold text-fg">{quiz.title}</div>
        )}
        <div className="truncate text-xs text-fg-muted">
          Edited {relativeDate(quiz.updatedAt)} · {summarizeArtifact(quiz.payload)}
        </div>
        {courseLabel && <div className="truncate text-xs text-fg-muted">{courseLabel}</div>}
      </div>
    </>
  );

  const shell = "flex flex-col overflow-hidden rounded-xl border border-border bg-surface text-left transition hover:border-accent";

  if (renaming) {
    return <div className={shell}>{body}</div>;
  }

  return (
    <Link
      href={`/quizzes/${quiz.id}`}
      onContextMenu={(e) => { e.preventDefault(); setDraft(quiz.title); onStartRename(); }}
      title="Right-click to rename"
      className={shell}
    >
      {body}
    </Link>
  );
}
