"use client";

/**
 * Compat shim: `app/page.tsx` (Agent D's file, off-limits to me) imports
 * `Chat` from here with this exact prop shape. The real chat surface now
 * lives in `components/chat/ChatShell.tsx` and is also used directly by
 * `app/(chat)/chats/[chatId]/page.tsx` for navigable per-chat URLs — this
 * file just adapts page.tsx's props onto it so the root route keeps working
 * unmodified.
 */
import { ChatShell } from "@/components/chat/ChatShell";

export function Chat(props: {
  chatId: string;
  chatTitle: string;
  courseName: string | null;
  userName: string;
}) {
  return (
    <ChatShell
      chatId={props.chatId}
      initialTitle={props.chatTitle}
      initialCourseId={null}
      initialCourseName={props.courseName}
      userName={props.userName}
    />
  );
}
