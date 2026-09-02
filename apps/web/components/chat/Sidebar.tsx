"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { signOutAction } from "@/lib/auth/actions";
import type { ChatSummary, CourseSummary } from "./types";

/**
 * Conversation list, grouped the way §8 splits Courses (siloed) from Chats
 * (general): a chat with a courseId is grouped under its course; courseId
 * null lands in the flat "Chats" section.
 */
export function Sidebar({
  userName,
  activeChatId,
  chats,
  courses,
  onNewChat,
  newChatBusy,
}: {
  userName: string;
  activeChatId: string;
  chats: ChatSummary[];
  courses: CourseSummary[];
  onNewChat: (courseId: string | null) => void;
  newChatBusy: boolean;
}) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [menuOpen, setMenuOpen] = useState(false);

  const q = query.trim().toLowerCase();
  const matches = (chat: ChatSummary) => !q || chat.title.toLowerCase().includes(q);

  const byCourse = new Map<string, ChatSummary[]>();
  const general: ChatSummary[] = [];
  for (const c of chats) {
    if (c.courseId) {
      const list = byCourse.get(c.courseId) ?? [];
      list.push(c);
      byCourse.set(c.courseId, list);
    } else {
      general.push(c);
    }
  }

  const filteredGeneral = useMemo(() => general.filter(matches), [general, q]);

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-sidebar px-3 py-4">
      <div className="px-1 text-base font-semibold text-fg">Mola</div>

      <button
        type="button"
        className="mb-2 mt-3 rounded-lg border border-dashed border-border px-2.5 py-2 text-left text-sm text-fg hover:bg-surface disabled:cursor-default disabled:opacity-50"
        onClick={() => onNewChat(null)}
        disabled={newChatBusy}
      >
        + New chat
      </button>

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search chats…"
        className="mb-3 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-fg placeholder:text-fg-muted focus:outline-none focus:ring-1 focus:ring-accent"
      />

      {courses.map((course) => {
        const courseChats = (byCourse.get(course.id) ?? []).filter(matches);
        if (q && courseChats.length === 0) return null;
        const isCollapsed = collapsed[course.id] ?? false;
        return (
          <div className="mb-3" key={course.id}>
            <button
              type="button"
              className="mb-1 flex w-full items-center justify-between gap-2 rounded-md px-1 py-0.5 text-xs font-medium uppercase tracking-wide text-fg-muted hover:text-fg"
              onClick={() => setCollapsed((c) => ({ ...c, [course.id]: !isCollapsed }))}
              aria-expanded={!isCollapsed}
            >
              <span className="flex min-w-0 items-center gap-1.5 truncate">
                <span className="text-[10px]">{isCollapsed ? "▸" : "▾"}</span>
                <span className="truncate">
                  {course.number ? `${course.number} ` : ""}
                  {course.name}
                </span>
              </span>
              <span
                role="button"
                tabIndex={0}
                className="shrink-0 rounded px-1 text-sm normal-case text-fg-muted hover:text-accent"
                title={`New chat in ${course.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!newChatBusy) onNewChat(course.id);
                }}
              >
                +
              </span>
            </button>
            {!isCollapsed && (
              <>
                {courseChats.length === 0 && <div className="px-1 py-1 text-xs text-fg-muted">No chats yet</div>}
                {courseChats.map((chat) => (
                  <ChatLink key={chat.id} chat={chat} active={chat.id === activeChatId} />
                ))}
              </>
            )}
          </div>
        );
      })}

      <div className="mb-3">
        <div className="mb-1 px-1 py-0.5 text-xs font-medium uppercase tracking-wide text-fg-muted">Chats</div>
        {filteredGeneral.length === 0 && (
          <div className="px-1 py-1 text-xs text-fg-muted">{q ? "No matches" : "No general chats yet"}</div>
        )}
        {filteredGeneral.map((chat) => (
          <ChatLink key={chat.id} chat={chat} active={chat.id === activeChatId} />
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
            <Link
              href="/settings"
              className="block rounded-md px-2.5 py-1.5 text-sm text-fg no-underline hover:bg-bg"
              onClick={() => setMenuOpen(false)}
            >
              Settings
            </Link>
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
          <span className="shrink-0 text-[10px] text-fg-muted">{menuOpen ? "▾" : "▸"}</span>
        </button>
      </div>
    </aside>
  );
}

function ChatLink({ chat, active }: { chat: ChatSummary; active: boolean }) {
  return (
    <Link
      href={`/chats/${chat.id}`}
      className={`block truncate rounded-md px-2 py-1.5 text-[13.5px] text-fg no-underline hover:bg-surface ${
        active ? "bg-surface font-semibold" : ""
      }`}
    >
      {chat.title}
    </Link>
  );
}
