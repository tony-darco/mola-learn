"use client";

import Link from "next/link";
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

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">Mola</div>
      <div className="sidebar-user">
        {userName} · <a href="/dev-signin">switch user</a>
      </div>

      <button
        type="button"
        className="sidebar-new-chat"
        onClick={() => onNewChat(null)}
        disabled={newChatBusy}
      >
        + New chat
      </button>

      {courses.map((course) => {
        const courseChats = byCourse.get(course.id) ?? [];
        return (
          <div className="sidebar-section" key={course.id}>
            <div className="sidebar-section-header">
              <span>{course.number ? `${course.number} ` : ""}{course.name}</span>
              <button
                type="button"
                className="sidebar-section-add"
                onClick={() => onNewChat(course.id)}
                disabled={newChatBusy}
                title={`New chat in ${course.name}`}
              >
                +
              </button>
            </div>
            {courseChats.length === 0 && <div className="sidebar-empty">No chats yet</div>}
            {courseChats.map((chat) => (
              <ChatLink key={chat.id} chat={chat} active={chat.id === activeChatId} />
            ))}
          </div>
        );
      })}

      <div className="sidebar-section">
        <div className="sidebar-section-header"><span>Chats</span></div>
        {general.length === 0 && <div className="sidebar-empty">No general chats yet</div>}
        {general.map((chat) => (
          <ChatLink key={chat.id} chat={chat} active={chat.id === activeChatId} />
        ))}
      </div>
    </aside>
  );
}

function ChatLink({ chat, active }: { chat: ChatSummary; active: boolean }) {
  return (
    <Link
      href={`/chats/${chat.id}`}
      className={`sidebar-chat-link${active ? " sidebar-chat-link-active" : ""}`}
    >
      {chat.title}
    </Link>
  );
}
