"use client";

/**
 * Compat shim over the real chat surface in `components/chat/ChatShell.tsx`.
 * `app/page.tsx` (root route) depends on this exact prop shape.
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
