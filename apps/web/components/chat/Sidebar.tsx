"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { signOutAction } from "@/lib/auth/actions";
import { ChatLink } from "./ChatLink";
import type { ChatSummary, CourseSummary } from "./types";

// Placeholders for features not built yet — styled like the Courses/Chats
// section headers, sitting above Courses. Not wired to anything yet.
const PLACEHOLDER_SECTIONS = ["Quizzes", "Flashcards", "Plan", "Schedule"] as const;

/**
 * Courses are a navigational list here — clicking one goes to its own page
 * (course details, its recent chats, its memory/context), not an inline
 * sublist. Every chat, regardless of which course it belongs to, shows in
 * one flat "Chats" list, newest first — that's also where a chat started
 * from this sidebar lands.
 */
export function Sidebar({
  userName,
  activeChatId,
  chats,
  courses,
  onNewChat,
  newChatBusy,
  onOpenSettings,
  onOpenSearch,
}: {
  userName: string;
  activeChatId: string;
  chats: ChatSummary[];
  courses: CourseSummary[];
  onNewChat: (courseId: string | null) => void;
  newChatBusy: boolean;
  onOpenSettings: () => void;
  onOpenSearch: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  // Stable sort: pinned chats float to the top, most-recent-first within
  // each group, since `chats` already arrives sorted by updatedAt.
  const sortedChats = useMemo(() => [...chats].sort((a, b) => b.isPinned - a.isPinned), [chats]);

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-sidebar px-3 py-4">
      <div className="flex min-h-[25vh] flex-col">
        <div className="px-1 text-xl font-semibold text-fg">Mola</div>

        <button
          type="button"
          className="mb-2 mt-3 px-2.5 py-1.5 text-left text-base text-fg hover:bg-surface disabled:cursor-default disabled:opacity-50"
          onClick={() => onNewChat(null)}
          disabled={newChatBusy}
        >
          + New chat
        </button>

        <div className="mb-4 flex flex-col gap-0.5">
          {PLACEHOLDER_SECTIONS.map((label) => (
            <div key={label} className="px-1 py-0.5 text-sm font-medium uppercase tracking-wide text-fg-muted">
              {label}
            </div>
          ))}
        </div>

        {courses.length > 0 && (
          <div className="mb-6">
            <div className="mb-1 px-1 py-0.5 text-sm font-medium uppercase tracking-wide text-fg-muted">Courses</div>
            {courses.map((course) => (
              <Link
                key={course.id}
                href={`/courses/${course.id}`}
                className="block truncate rounded-md px-2 py-1.5 text-sm text-fg no-underline hover:bg-surface"
              >
                {course.number ? `${course.number} ` : ""}
                {course.name}
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="mb-3">
        <div className="mb-1 px-1 py-0.5 text-sm font-medium uppercase tracking-wide text-fg-muted">Chats</div>
        {sortedChats.length === 0 && (
          <div className="px-1 py-1 text-sm text-fg-muted">No chats yet</div>
        )}
        {sortedChats.map((chat) => (
          <ChatLink key={chat.id} chat={chat} active={chat.id === activeChatId} courses={courses} />
        ))}
      </div>

      <div className="mt-auto flex flex-col gap-1">
        <button
          type="button"
          onClick={onOpenSearch}
          className="flex items-center gap-2 rounded-md px-1 py-1.5 text-left text-base text-fg-muted hover:bg-surface hover:text-fg"
        >
          <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          Search
        </button>

        <div className="relative border-t border-border pt-3">
          {menuOpen && (
            <div className="absolute bottom-full left-0 mb-1 w-full rounded-lg border border-border bg-surface p-1 shadow-lg">
              <Link
                href="/courses"
                className="block rounded-md px-2.5 py-1.5 text-sm text-fg no-underline hover:bg-bg"
                onClick={() => setMenuOpen(false)}
              >
                Courses
              </Link>
              <Link
                href="/profile"
                className="block rounded-md px-2.5 py-1.5 text-sm text-fg no-underline hover:bg-bg"
                onClick={() => setMenuOpen(false)}
              >
                Profile
              </Link>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenSettings();
                }}
                className="block w-full rounded-md px-2.5 py-1.5 text-left text-sm text-fg hover:bg-bg"
              >
                Settings
              </button>
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="block w-full rounded-md px-2.5 py-1.5 text-left text-sm text-fg hover:bg-bg"
                >
                  Sign out
                </button>
              </form>
            </div>
          )}
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-1 py-1 hover:bg-surface"
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-fg">
              {userName.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 truncate text-left text-sm text-fg">{userName}</span>
            <span className="shrink-0 text-base leading-none text-fg-muted">{menuOpen ? "▾" : "▸"}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
