"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ChatSummary, CourseSummary } from "./types";

/** Spotlight-style: opens over the current page (same blurred backdrop as SettingsModal), live-filters as you type. */
export function SearchModal({
  open, onClose, chats, courses,
}: { open: boolean; onClose: () => void; chats: ChatSummary[]; courses: CourseSummary[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [open, onClose]);

  const q = query.trim().toLowerCase();
  const matchedCourses = useMemo(
    () => (q ? courses.filter((c) => c.name.toLowerCase().includes(q) || (c.number ?? "").toLowerCase().includes(q)) : courses),
    [courses, q],
  );
  const matchedChats = useMemo(
    () => (q ? chats.filter((c) => c.title.toLowerCase().includes(q)) : chats),
    [chats, q],
  );

  if (!open) return null;

  function go(href: string) {
    onClose();
    router.push(href);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 pt-32 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[65vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <svg className="h-5 w-5 shrink-0 text-fg-muted" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats and courses…"
            className="flex-1 bg-transparent text-lg text-fg placeholder:text-fg-muted focus:outline-none"
          />
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {matchedCourses.length === 0 && matchedChats.length === 0 && (
            <div className="px-2 py-8 text-center text-base text-fg-muted">No results</div>
          )}

          {matchedCourses.length > 0 && (
            <div className="mb-3">
              <div className="px-2 py-1.5 text-xs font-medium uppercase tracking-wide text-fg-muted">Courses</div>
              {matchedCourses.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => go(`/courses/${c.id}`)}
                  className="flex w-full items-center rounded-md px-3 py-2.5 text-left text-base text-fg hover:bg-bg"
                >
                  <span className="truncate">
                    {c.number ? `${c.number} ` : ""}
                    {c.name}
                  </span>
                </button>
              ))}
            </div>
          )}

          {matchedChats.length > 0 && (
            <div>
              <div className="px-2 py-1.5 text-xs font-medium uppercase tracking-wide text-fg-muted">Chats</div>
              {matchedChats.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => go(`/chats/${c.id}`)}
                  className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left text-base text-fg hover:bg-bg"
                >
                  <span className="truncate">{c.title}</span>
                  <span className="shrink-0 text-sm text-fg-muted">{new Date(c.updatedAt).toLocaleDateString()}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
