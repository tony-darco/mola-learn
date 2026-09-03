"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChatContextMenu } from "./ChatContextMenu";
import { useRefreshSidebar } from "./shell-context";
import type { ChatSummary, CourseSummary } from "./types";

export function ChatLink({
  chat,
  active,
  courses,
}: {
  chat: ChatSummary;
  active: boolean;
  courses: CourseSummary[];
}) {
  const router = useRouter();
  const refreshSidebar = useRefreshSidebar();
  const [isMutating, setIsMutating] = useState(false);

  const handleUpdate = async (updates: { title?: string; courseId?: string | null; isPinned?: boolean }) => {
    setIsMutating(true);
    try {
      const response = await fetch(`/api/chat/${chat.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!response.ok) throw new Error("Failed to update chat");
      refreshSidebar();
    } finally {
      setIsMutating(false);
    }
  };

  const handleDelete = async () => {
    setIsMutating(true);
    try {
      const response = await fetch(`/api/chat/${chat.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to delete chat");
      // Deleting the chat you're currently looking at would otherwise leave
      // you on a now-404ing URL.
      if (active) router.push("/");
      refreshSidebar();
    } finally {
      setIsMutating(false);
    }
  };

  return (
    <div className="group flex items-center gap-0 rounded-md hover:bg-surface">
      <Link
        href={`/chats/${chat.id}`}
        data-testid="sidebar-chat-link"
        className={`flex min-w-0 flex-1 items-center gap-1.5 truncate rounded-md px-2 py-1.5 text-sm text-fg no-underline ${
          active ? "bg-surface font-semibold" : ""
        } ${isMutating ? "opacity-50" : ""}`}
      >
        {chat.isPinned > 0 ? (
          <svg className="h-3 w-3 shrink-0 text-fg-muted" fill="currentColor" viewBox="0 0 24 24" aria-label="Pinned">
            <path d="M12 2a5 5 0 0 0-5 5c0 2.2 1.5 4.1 3.5 4.8L9 16h6l-1.5-4.2c2-.7 3.5-2.6 3.5-4.8a5 5 0 0 0-5-5zm-1 15v5h2v-5z" />
          </svg>
        ) : (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full border border-fg-muted" aria-hidden="true" />
        )}
        <span className="truncate">{chat.title}</span>
      </Link>
      <ChatContextMenu
        chat={chat}
        courses={courses}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
      />
    </div>
  );
}
