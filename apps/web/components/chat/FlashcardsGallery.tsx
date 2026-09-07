"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ArtifactRecord } from "@mola/shared";
import type { CourseOption, TermOption } from "@/lib/flashcards/gallery";
import { renameDeckAction } from "@/lib/flashcards/actions";
import { artifactIcon, summarizeArtifact } from "./artifact-summary";

/** `ArtifactRecord` with dates as the ISO strings the server page sends over the RSC boundary. */
type ClientDeck = Omit<ArtifactRecord, "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string };

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
 * The Flashcards gallery: a Claude.ai-Artifacts-style card grid over this
 * user's own decks (never another user's — the server page already scoped
 * the read by userId). Filtering/sorting happens client-side because the
 * whole dataset is one student's own artifacts — small, already fetched,
 * and this mirrors how SearchModal already filters chats/courses in-browser
 * rather than round-tripping to an API per keystroke.
 */
export function FlashcardsGallery({
  decks: serverDecks, courses, terms,
}: { decks: ClientDeck[]; courses: CourseOption[]; terms: TermOption[] }) {
  const [search, setSearch] = useState("");
  const [courseFilter, setCourseFilter] = useState("all");
  const [textbookFilter, setTextbookFilter] = useState("all");
  const [termFilter, setTermFilter] = useState("all");
  const [sortBy, setSortBy] = useState<SortKey>("modified");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamed, setRenamed] = useState<Record<string, string>>({});
  const router = useRouter();

  // A rename shows immediately rather than waiting on the server round trip
  // and re-render; router.refresh() below reconciles it with the real row.
  const decks = useMemo(
    () => serverDecks.map((d) => (renamed[d.id] ? { ...d, title: renamed[d.id]! } : d)),
    [serverDecks, renamed],
  );

  /** Commits an inline rename. Saved on blur — same as the deck page's title. */
  async function rename(deckId: string, next: string, current: string) {
    setRenamingId(null);
    const trimmed = next.trim();
    if (!trimmed || trimmed === current) return;
    setRenamed((r) => ({ ...r, [deckId]: trimmed }));
    await renameDeckAction(deckId, trimmed);
    router.refresh();
  }

  const courseMap = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);
  const termMap = useMemo(() => new Map(terms.map((t) => [t.id, t])), [terms]);

  const textbookOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of decks) for (const s of d.sources) map.set(s.documentId, s.documentTitle);
    return [...map.entries()];
  }, [decks]);

  function courseLabel(courseId: string | null): string | null {
    if (!courseId) return null;
    const c = courseMap.get(courseId);
    if (!c) return null;
    return c.number ? `${c.number} — ${c.name}` : c.name;
  }

  function termIdForDeck(courseId: string | null): string | null {
    if (!courseId) return null;
    return courseMap.get(courseId)?.termId ?? null;
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = decks.filter((d) => {
      if (courseFilter === NO_COURSE && d.courseId !== null) return false;
      if (courseFilter !== "all" && courseFilter !== NO_COURSE && d.courseId !== courseFilter) return false;

      if (textbookFilter !== "all" && !d.sources.some((s) => s.documentId === textbookFilter)) return false;

      if (termFilter !== "all") {
        const termId = termIdForDeck(d.courseId);
        if (termFilter === NO_COURSE && termId !== null) return false;
        if (termFilter !== NO_COURSE && termId !== termFilter) return false;
      }

      if (q) {
        const inTitle = d.title.toLowerCase().includes(q);
        const inTopics = d.topics.some((t) => t.toLowerCase().includes(q));
        const inSources = d.sources.some((s) => s.documentTitle.toLowerCase().includes(q));
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
  }, [decks, courseFilter, textbookFilter, termFilter, search, sortBy, courseMap]);

  return (
    <div>
      <h1 className="mb-4 text-3xl font-semibold text-fg">Flashcards</h1>

      {/* Tabs — a single "All decks" tab: this app has no sharing model, so
          the Claude.ai "Shared with you" tab has nothing to point at. */}
      <div className="mb-4 flex gap-4 border-b border-border">
        <div className="border-b-2 border-accent px-1 pb-2 text-sm font-medium text-fg">All decks</div>
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
            placeholder="Search decks…"
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

      {decks.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-10 text-center text-sm text-fg-muted">
          No flashcard decks yet — ask Mola to build one from a chat.
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-10 text-center text-sm text-fg-muted">
          No decks match your filters.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((d) => (
            <DeckCard
              key={d.id}
              deck={d}
              courseLabel={courseLabel(d.courseId)}
              renaming={renamingId === d.id}
              onStartRename={() => setRenamingId(d.id)}
              onCommitRename={(next) => void rename(d.id, next, d.title)}
              onCancelRename={() => setRenamingId(null)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DeckCard({
  deck, courseLabel, renaming, onStartRename, onCommitRename, onCancelRename,
}: {
  deck: ClientDeck;
  courseLabel: string | null;
  renaming: boolean;
  onStartRename: () => void;
  onCommitRename: (next: string) => void;
  onCancelRename: () => void;
}) {
  const cards = deck.payload.kind === "flashcard_deck" ? deck.payload.cards : [];
  const preview = cards.slice(0, 3).map((c) => c.front);
  const [draft, setDraft] = useState(deck.title);

  const body = (
    <>
      <div className="flex h-28 flex-col justify-center gap-1 overflow-hidden bg-bg px-4 py-3">
        {preview.length === 0 ? (
          <span className="text-2xl text-fg-muted" aria-hidden="true">{artifactIcon(deck.payload.kind)}</span>
        ) : (
          preview.map((front, i) => (
            <div key={i} className="truncate text-xs text-fg-muted">{front}</div>
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
              if (e.key === "Escape") { e.preventDefault(); setDraft(deck.title); onCancelRename(); }
            }}
            aria-label="Deck title"
            className="w-full rounded-md border border-border bg-bg px-1.5 py-0.5 text-sm font-semibold text-fg focus:outline-none"
          />
        ) : (
          <div className="truncate text-sm font-semibold text-fg">{deck.title}</div>
        )}
        <div className="truncate text-xs text-fg-muted">
          Edited {relativeDate(deck.updatedAt)} · {summarizeArtifact(deck.payload)}
        </div>
        {courseLabel && <div className="truncate text-xs text-fg-muted">{courseLabel}</div>}
      </div>
    </>
  );

  const shell = "flex flex-col overflow-hidden rounded-xl border border-border bg-surface text-left transition hover:border-accent";

  // While renaming the card is NOT a link — otherwise clicking into the text
  // box would navigate to the deck instead of letting you type.
  if (renaming) {
    return <div className={shell}>{body}</div>;
  }

  return (
    <Link
      href={`/flashcards/${deck.id}`}
      onContextMenu={(e) => { e.preventDefault(); setDraft(deck.title); onStartRename(); }}
      title="Right-click to rename"
      className={shell}
    >
      {body}
    </Link>
  );
}
