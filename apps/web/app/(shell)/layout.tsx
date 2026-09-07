import type { ReactNode } from "react";
import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { chats, courses, db } from "@mola/db";
import { getSession } from "@/lib/auth/session";
import { ensurePlansForToday } from "@/lib/planning";
import { runDueJobs } from "@/lib/jobs/worker";
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

  // §5's cadence needs a clock somewhere, and this app has no daemon running
  // in dev. `after()` runs once the response has already streamed, so a
  // student never waits on an LLM plan generation just to open a page — the
  // proposal shows up on the NEXT load, which is exactly the "persists and is
  // presented on next open, whatever day that is" behaviour the plan calls
  // for. ensurePlansForToday only enqueues; runDueJobs is what actually spends
  // a generation, and both are cheap no-ops once the day/week is caught up.
  after(async () => {
    await ensurePlansForToday(session.userId);
    await runDueJobs();
  });

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
