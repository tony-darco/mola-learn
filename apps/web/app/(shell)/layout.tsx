import type { ReactNode } from "react";
import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { chats, courses, db } from "@mola/db";
import { getSession } from "@/lib/auth/session";
import { AppShell } from "@/components/chat/AppShell";

export const dynamic = "force-dynamic";

/**
 * Shared chrome for every chat- and course-facing page: the sidebar stays
 * mounted here across navigations (Next.js preserves a layout's component
 * tree across page changes within it), so switching chats or opening a
 * course no longer remounts it.
 */
export default async function ShellLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const [userChats, userCourses] = await Promise.all([
    db.select({
      id: chats.id, title: chats.title, courseId: chats.courseId, updatedAt: chats.updatedAt, isPinned: chats.isPinned,
    }).from(chats).where(eq(chats.userId, session.userId)).orderBy(desc(chats.updatedAt)),
    db.select({
      id: courses.id, name: courses.name, number: courses.number,
    }).from(courses).where(eq(courses.userId, session.userId)),
  ]);

  const initialChats = userChats.map((c) => ({ ...c, updatedAt: c.updatedAt.toISOString() }));

  return (
    <AppShell userName={session.email} initialChats={initialChats} initialCourses={userCourses}>
      {children}
    </AppShell>
  );
}
