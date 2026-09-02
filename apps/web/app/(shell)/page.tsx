import { desc, eq, sql } from "drizzle-orm";
import { chats, courses, db } from "@mola/db";
import { getSession } from "@/lib/auth/session";
import { ChatMain } from "@/components/chat/ChatMain";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getSession();
  if (!session) return null; // ShellLayout already redirected; unreachable in practice.

  const [chat] = await db.select().from(chats)
    .where(eq(chats.userId, session.userId))
    .orderBy(desc(chats.createdAt)).limit(1);

  if (!chat) {
    // Not an error: a fresh account (or the seeded Bob, who owns nothing) has no
    // chats yet — the §9 ownership model working, not a missing seed. They may
    // still have a course with no chat started in it yet, so check separately
    // rather than implying "no courses" when one exists.
    const courseCountRows = await db
      .select({ courseCount: sql<number>`count(*)::int` })
      .from(courses)
      .where(eq(courses.userId, session.userId));
    const courseCount = courseCountRows[0]?.courseCount ?? 0;

    return (
      <main className="chat-main flex items-center justify-center">
        <div className="max-w-sm text-center">
          <h1 className="mb-1 text-xl font-semibold text-fg">Mola</h1>
          <p className="mb-4 text-fg-muted">
            Signed in as <strong className="text-fg">{session.email}</strong>, who has no chats yet
            {courseCount === 0 ? " and no courses yet" : ""}.
          </p>
          <a
            href={courseCount === 0 ? "/courses/new" : "/courses"}
            className="inline-block rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-fg no-underline"
          >
            {courseCount === 0 ? "Add a course" : "View your courses"}
          </a>
        </div>
      </main>
    );
  }

  return <ChatMain chatId={chat.id} />;
}
