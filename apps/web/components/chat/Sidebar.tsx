"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOutAction } from "@/lib/auth/actions";
import { ChatLink } from "./ChatLink";
import type { SettingsSection } from "./SettingsModal";
import type { ChatSummary, CourseSummary } from "./types";

const DEFAULT_WIDTH = 288;
const MIN_WIDTH = 220;
const MAX_WIDTH = 440;

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
  onOpenSettings: (section?: SettingsSection) => void;
  onOpenSearch: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [collapsed, setCollapsed] = useState(false);
  const [handleHover, setHandleHover] = useState(false);
  const dragStart = useRef<{ x: number; width: number } | null>(null);
  const didDrag = useRef(false);

  // Stable sort: pinned chats float to the top, most-recent-first within
  // each group, since `chats` already arrives sorted by updatedAt — a newly
  // created or just-updated chat is already first, so nothing extra is
  // needed to keep new chats at the top of the list.
  const sortedChats = useMemo(() => [...chats].sort((a, b) => b.isPinned - a.isPinned), [chats]);
  const VISIBLE_CHAT_LIMIT = 10;
  const visibleChats = sortedChats.slice(0, VISIBLE_CHAT_LIMIT);
  const hasMoreChats = sortedChats.length > VISIBLE_CHAT_LIMIT;

  const onPointerMove = useCallback((e: PointerEvent) => {
    if (!dragStart.current) return;
    const delta = e.clientX - dragStart.current.x;
    if (Math.abs(delta) > 2) didDrag.current = true;
    const next = Math.min(Math.max(dragStart.current.width + delta, MIN_WIDTH), MAX_WIDTH);
    setWidth(next);
  }, []);

  const onPointerUp = useCallback(() => {
    dragStart.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }, [onPointerMove]);

  useEffect(() => () => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }, [onPointerMove, onPointerUp]);

  function startDrag(e: React.PointerEvent) {
    didDrag.current = false;
    dragStart.current = { x: e.clientX, width };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="fixed left-3 top-4 z-20 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface hover:text-fg"
        aria-label="Expand sidebar"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <line x1="10" y1="4" x2="10" y2="20" />
        </svg>
      </button>
    );
  }

  return (
    <aside className="relative flex h-full shrink-0 flex-col border-r border-border bg-sidebar" style={{ width }}>
      {/* No overflow-y-auto here — the Chats list below scrolls on its own,
          independent of this header/nav block and the footer, both of which
          stay put. */}
      <div className="flex h-full min-h-0 flex-col gap-1 px-4 py-4">
        <div className="flex min-h-[25vh] shrink-0 flex-col">
          <Link href="/chat" className="px-1 text-xl font-semibold text-fg no-underline">Mola</Link>

          <button
            type="button"
            className="mb-2 mt-3 px-2.5 py-1.5 text-left text-base text-fg hover:bg-surface disabled:cursor-default disabled:opacity-50"
            onClick={() => onNewChat(null)}
            disabled={newChatBusy}
          >
            + New chat
          </button>

          <div className="mb-4 flex flex-col gap-2">
            <Link
              href="/artifacts"
              className={`rounded-md px-1 py-0.5 text-sm font-medium uppercase tracking-wide no-underline hover:text-fg ${
                pathname === "/artifacts" ? "text-fg" : "text-fg-muted"
              }`}
            >
              Artifacts
            </Link>
            <Link
              href="/quizzes"
              className={`rounded-md px-1 py-0.5 text-sm font-medium uppercase tracking-wide no-underline hover:text-fg ${
                pathname === "/quizzes" ? "text-fg" : "text-fg-muted"
              }`}
            >
              Quizzes
            </Link>
            <Link
              href="/flashcards"
              className={`rounded-md px-1 py-0.5 text-sm font-medium uppercase tracking-wide no-underline hover:text-fg ${
                pathname === "/flashcards" ? "text-fg" : "text-fg-muted"
              }`}
            >
              Flashcards
            </Link>
            <Link
              href="/plan"
              className={`rounded-md px-1 py-0.5 text-sm font-medium uppercase tracking-wide no-underline hover:text-fg ${
                pathname === "/plan" ? "text-fg" : "text-fg-muted"
              }`}
            >
              Plan
            </Link>
            <Link
              href="/calendar"
              className={`rounded-md px-1 py-0.5 text-sm font-medium uppercase tracking-wide no-underline hover:text-fg ${
                pathname === "/calendar" ? "text-fg" : "text-fg-muted"
              }`}
            >
              Schedule
            </Link>
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

        <div className="mb-3 flex min-h-0 flex-1 flex-col">
          <div className="mb-1 shrink-0 px-1 py-0.5 text-sm font-medium uppercase tracking-wide text-fg-muted">Chats</div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {sortedChats.length === 0 && (
              <div className="px-1 py-1 text-sm text-fg-muted">No chats yet</div>
            )}
            {visibleChats.map((chat) => (
              <ChatLink key={chat.id} chat={chat} active={chat.id === activeChatId} courses={courses} />
            ))}
          </div>
          {hasMoreChats && (
            <button
              type="button"
              onClick={onOpenSearch}
              className="shrink-0 rounded-md px-2 py-1.5 text-left text-sm text-fg-muted hover:bg-surface hover:text-fg"
            >
              View all conversations
            </button>
          )}
        </div>

        <div className="mt-auto shrink-0 flex flex-col gap-1">
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
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenSettings("courses");
                  }}
                  className="block w-full rounded-md px-2.5 py-1.5 text-left text-sm text-fg hover:bg-bg"
                >
                  Courses
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenSettings("account");
                  }}
                  className="block w-full rounded-md px-2.5 py-1.5 text-left text-sm text-fg hover:bg-bg"
                >
                  Account
                </button>
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
                <button
                  type="button"
                  onClick={async () => {
                    setMenuOpen(false);
                    await signOutAction();
                    router.push("/sign-in");
                  }}
                  className="block w-full rounded-md px-2.5 py-1.5 text-left text-sm text-fg hover:bg-bg"
                >
                  Sign out
                </button>
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
      </div>

      {/* Wider than the visible border for an easy grab target; drag resizes,
          a plain click on the notch collapses the sidebar. */}
      <div
        onPointerDown={startDrag}
        onPointerEnter={() => setHandleHover(true)}
        onPointerLeave={() => setHandleHover(false)}
        onClick={() => {
          if (!didDrag.current) setCollapsed(true);
        }}
        className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
      >
        {handleHover && (
          <span
            className="absolute left-1/2 top-1/2 flex h-9 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md border border-border bg-surface text-fg-muted shadow-sm"
            aria-hidden="true"
          >
            <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </span>
        )}
      </div>
    </aside>
  );
}
