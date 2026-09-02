"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { RefreshSidebarContext } from "./shell-context";
import type { ChatSummary, CourseSummary } from "./types";

type ListResponse = { chats: ChatSummary[]; courses: CourseSummary[] };

/**
 * The persistent app shell: sidebar stays mounted across every navigation
 * inside it (chat pages, a course's page) — only `children` (the main
 * content pane) swaps, via Next.js's normal layout-persists-across-pages
 * behavior. Previously the sidebar was rendered fresh inside every chat
 * page, so switching chats fully remounted it (a visible reload-like flash,
 * and the chat/course list re-fetched from scratch every time).
 */
export function AppShell({
  userName,
  initialChats,
  initialCourses,
  children,
}: {
  userName: string;
  initialChats: ChatSummary[];
  initialCourses: CourseSummary[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [chats, setChats] = useState<ChatSummary[]>(initialChats);
  const [courses, setCourses] = useState<CourseSummary[]>(initialCourses);
  const [newChatBusy, setNewChatBusy] = useState(false);

  const activeChatId = pathname.startsWith("/chats/") ? (pathname.split("/")[2] ?? "") : "";

  const refreshSidebar = useCallback(() => {
    fetch("/api/chat")
      .then((res) => (res.ok ? (res.json() as Promise<ListResponse>) : null))
      .then((data) => {
        if (!data) return;
        setChats(data.chats);
        setCourses(data.courses);
      })
      .catch(() => { /* sidebar list is a convenience, not load-bearing */ });
  }, []);

  // Covers new-chat creation and switching between existing chats/courses —
  // anything that changes which chat should be highlighted or what the list
  // should contain lands on a new pathname.
  useEffect(() => {
    refreshSidebar();
  }, [pathname, refreshSidebar]);

  async function handleNewChat(courseId: string | null) {
    if (newChatBusy) return;
    setNewChatBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ courseId }),
      });
      if (!res.ok) throw new Error(`failed to create chat (${res.status})`);
      const { id } = (await res.json()) as { id: string };
      router.push(`/chats/${id}`);
    } catch {
      // Sidebar action failing is non-fatal — the user stays where they are.
    } finally {
      setNewChatBusy(false);
    }
  }

  return (
    <div className="chat-layout">
      <Sidebar
        userName={userName}
        activeChatId={activeChatId}
        chats={chats}
        courses={courses}
        onNewChat={handleNewChat}
        newChatBusy={newChatBusy}
      />
      <RefreshSidebarContext.Provider value={refreshSidebar}>
        {children}
      </RefreshSidebarContext.Provider>
    </div>
  );
}
