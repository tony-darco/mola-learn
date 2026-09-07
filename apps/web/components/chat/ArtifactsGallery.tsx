"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ArtifactRecord, ArtifactKind } from "@mola/shared";
import type { CourseOption, TermOption } from "@/lib/artifacts/filters";
import { artifactIcon, summarizeArtifact } from "./artifact-summary";

type ClientArtifact = Omit<ArtifactRecord, "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string };

const selectClass =
  "rounded-lg border border-border bg-bg px-2.5 py-2 text-sm text-fg focus:outline-none";

type SortKey = "modified" | "created" | "title";
type KindFilter = "all" | ArtifactKind;
const NO_COURSE = "__none__";

const KIND_LABEL: Record<ArtifactKind, string> = {
  flashcard_deck: "Flashcards",
  quiz: "Quiz",
  mind_map: "Mind map",
};

const KIND_ROUTE: Record<ArtifactKind, string> = {
  flashcard_deck: "/flashcards",
  quiz: "/quizzes",
  mind_map: "/mindmaps",
};

function relativeDate(iso: string): string {
  const date = new Date(iso);
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function previewLines(a: ClientArtifact): string[] {
  switch (a.payload.kind) {
    case "flashcard_deck":
      return a.payload.cards.slice(0, 3).map((c) => c.front);
    case "quiz":
      return a.payload.questions.slice(0, 3).map((q) => q.prompt);
    case "mind_map":
      return a.payload.nodes.slice(0, 3).map((n) => n.label);
    default:
      return [];
  }
}

/**
 * The unified Artifacts gallery — every kind together, per the design doc's
 * original §8 spec. Same filter/sort/search shape as the per-kind galleries,
 * plus a Kind filter; each card links out to its own kind's dedicated page.
 */
export function ArtifactsGallery({
  artifacts, courses, terms,
}: { artifacts: ClientArtifact[]; courses: CourseOption[]; terms: TermOption[] }) {
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [courseFilter, setCourseFilter] = useState("all");
  const [textbookFilter, setTextbookFilter] = useState("all");
  const [termFilter, setTermFilter] = useState("all");
  const [sortBy, setSortBy] = useState<SortKey>("modified");

  const courseMap = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);

  const textbookOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of artifacts) for (const s of a.sources) map.set(s.documentId, s.documentTitle);
    return [...map.entries()];
  }, [artifacts]);

  function courseLabel(courseId: string | null): string | null {
    if (!courseId) return null;
    const c = courseMap.get(courseId);
    if (!c) return null;
    return c.number ? `${c.number} — ${c.name}` : c.name;
  }

  function termIdFor(courseId: string | null): string | null {
    if (!courseId) return null;
    return courseMap.get(courseId)?.termId ?? null;
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = artifacts.filter((a) => {
      if (kindFilter !== "all" && a.kind !== kindFilter) return false;

      if (courseFilter === NO_COURSE && a.courseId !== null) return false;
      if (courseFilter !== "all" && courseFilter !== NO_COURSE && a.courseId !== courseFilter) return false;

      if (textbookFilter !== "all" && !a.sources.some((s) => s.documentId === textbookFilter)) return false;

      if (termFilter !== "all") {
        const termId = termIdFor(a.courseId);
        if (termFilter === NO_COURSE && termId !== null) return false;
        if (termFilter !== NO_COURSE && termId !== termFilter) return false;
      }

      if (q) {
        const inTitle = a.title.toLowerCase().includes(q);
        const inTopics = a.topics.some((t) => t.toLowerCase().includes(q));
        const inSources = a.sources.some((s) => s.documentTitle.toLowerCase().includes(q));
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
  }, [artifacts, kindFilter, courseFilter, textbookFilter, termFilter, search, sortBy, courseMap]);

  return (
    <div>
      <h1 className="mb-4 text-3xl font-semibold text-fg">Artifacts</h1>

      <div className="mb-4 flex gap-4 border-b border-border">
        {(["all", "flashcard_deck", "quiz", "mind_map"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKindFilter(k)}
            className={`px-1 pb-2 text-sm font-medium ${
              kindFilter === k ? "border-b-2 border-accent text-fg" : "text-fg-muted hover:text-fg"
            }`}
          >
            {k === "all" ? "All" : KIND_LABEL[k]}
          </button>
        ))}
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
            placeholder="Search by title or topic…"
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

      {artifacts.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-10 text-center text-sm text-fg-muted">
          Nothing yet — ask Mola to build a flashcard deck, quiz, or mind map from a chat.
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-10 text-center text-sm text-fg-muted">
          Nothing matches your filters.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((a) => (
            <ArtifactCard key={a.id} artifact={a} courseLabel={courseLabel(a.courseId)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ArtifactCard({ artifact, courseLabel }: { artifact: ClientArtifact; courseLabel: string | null }) {
  const preview = previewLines(artifact);

  return (
    <Link
      href={`${KIND_ROUTE[artifact.kind]}/${artifact.id}`}
      className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface text-left transition hover:border-accent"
    >
      <div className="flex h-28 flex-col justify-center gap-1 overflow-hidden bg-bg px-4 py-3">
        {preview.length === 0 ? (
          <span className="text-2xl text-fg-muted" aria-hidden="true">{artifactIcon(artifact.payload.kind)}</span>
        ) : (
          preview.map((line, i) => (
            <div key={i} className="truncate text-xs text-fg-muted">{line}</div>
          ))
        )}
      </div>
      <div className="flex flex-col gap-1 border-t border-border p-3">
        <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-fg-muted">
          <span aria-hidden="true">{artifactIcon(artifact.payload.kind)}</span>
          {KIND_LABEL[artifact.kind]}
        </div>
        <div className="truncate text-sm font-semibold text-fg">{artifact.title}</div>
        <div className="truncate text-xs text-fg-muted">
          Edited {relativeDate(artifact.updatedAt)} · {summarizeArtifact(artifact.payload)}
        </div>
        {courseLabel && <div className="truncate text-xs text-fg-muted">{courseLabel}</div>}
      </div>
    </Link>
  );
}
