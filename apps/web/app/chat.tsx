"use client";

/**
 * Compat shim over the real chat surface in `components/chat/ChatShell.tsx`.
 *
 * Two callers depend on this exact prop shape:
 *   - `app/page.tsx` (root route)
 *   - `app/(app)/courses/[id]/page.tsx`, which passes `hideSidebar` because the
 *     course detail page draws its own nav chrome and chat-list pills.
 *
 * Merge note (checkpoint 1): Agents A and D changed this file in incompatible
 * directions — A reduced it to this shim, D extended the old inline component
 * with `hideSidebar`. Resolved by keeping the shim and threading D's prop
 * through to ChatShell, rather than taking either side wholesale.
 */
import { ChatShell } from "@/components/chat/ChatShell";

export function Chat(props: {
  chatId: string;
  chatTitle: string;
  courseName: string | null;
  userName: string;
  hideSidebar?: boolean;
}) {
  return (
    <ChatShell
      chatId={props.chatId}
      initialTitle={props.chatTitle}
      initialCourseId={null}
      initialCourseName={props.courseName}
      userName={props.userName}
      hideSidebar={props.hideSidebar}
    />
  );
}
