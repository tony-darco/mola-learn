"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { signOutAction } from "@/lib/auth/actions";
import { ChatLink } from "./ChatLink";
import type { ChatSummary, CourseSummary } from "./types";

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
}: {
  userName: string;
  activeChatId: string;
  chats: ChatSummary[];
  courses: CourseSummary[];
  onNewChat: (courseId: string | null) => void;
  newChatBusy: boolean;
  onOpenSettings: () => void;
}) {
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  const q = query.trim().toLowerCase();
  const filteredChats = useMemo(() => {
    const filtered = chats.filter((c) => !q || c.title.toLowerCase().includes(q));
    // Stable sort: pinned chats float to the top, most-recent-first within
    // each group, since `chats` already arrives sorted by updatedAt.
    return [...filtered].sort((a, b) => b.isPinned - a.isPinned);
  }, [chats, q]);

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-sidebar px-3 py-4">
      <div className="px-1 text-base font-semibold text-fg">Mola</div>

      <button
        type="button"
        className="mb-2 mt-3 px-2.5 py-1 text-left text-sm text-fg hover:bg-surface disabled:cursor-default disabled:opacity-50"
        onClick={() => onNewChat(null)}
        disabled={newChatBusy}
      >
        + New chat
      </button>

      {/* Reserved for other sidebar sections between "New chat" and
          "Courses" — e.g. artifacts, saved items — as they're built. */}
      <div className="mb-4" />

      {courses.length > 0 && (
        <div className="mb-6">
          <div className="mb-1 px-1 py-0.5 text-xs font-medium uppercase tracking-wide text-fg-muted">Courses</div>
          {courses.map((course) => (
            <Link
              key={course.id}
              href={`/courses/${course.id}`}
              className="block truncate rounded-md px-2 py-1.5 text-[13.5px] text-fg no-underline hover:bg-surface"
            >
              {course.number ? `${course.number} ` : ""}
              {course.name}
            </Link>
          ))}
        </div>
      )}

      <div className="mb-3">
        <div className="mb-1 px-1 py-0.5 text-xs font-medium uppercase tracking-wide text-fg-muted">Chats</div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search chats…"
          className="mb-2 w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-fg placeholder:text-fg-muted focus:outline-none focus:ring-1 focus:ring-accent"
        />
        {filteredChats.length === 0 && (
          <div className="px-1 py-1 text-xs text-fg-muted">{q ? "No matches" : "No chats yet"}</div>
        )}
        {filteredChats.map((chat) => (
          <ChatLink key={chat.id} chat={chat} active={chat.id === activeChatId} courses={courses} />
        ))}
      </div>

      <div className="relative mt-auto border-t border-border pt-3">
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
    </aside>
  );
}
