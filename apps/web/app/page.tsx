import { desc, eq, sql } from "drizzle-orm";
import { chats, courses, db } from "@mola/db";
import { getSession } from "@/lib/auth/session";
import { Chat } from "./chat";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getSession();
  if (!session) {
    return (
      <main style={{ maxWidth: 560, margin: "80px auto", padding: "0 24px" }}>
        <h1 style={{ marginBottom: 4 }}>Mola</h1>
        <p style={{ color: "var(--muted)", marginTop: 0 }}>
          Not signed in.
        </p>
        <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
          <a
            href="/sign-in"
            style={{
              display: "inline-block", padding: "12px 20px",
              borderRadius: 10, background: "var(--accent)", color: "#fff",
              textDecoration: "none", fontWeight: 600,
            }}
          >
            Sign in →
          </a>
          <a
            href="/sign-up"
            style={{
              display: "inline-block", padding: "12px 20px",
              borderRadius: 10, border: "1px solid var(--border)", color: "var(--text)",
              textDecoration: "none", fontWeight: 600,
            }}
          >
            Sign up
          </a>
        </div>
      </main>
    );
  }

  const [chat] = await db.select().from(chats)
    .where(eq(chats.userId, session.userId))
    .orderBy(desc(chats.createdAt)).limit(1);

  const course = chat?.courseId
    ? (await db.select().from(courses).where(eq(courses.id, chat.courseId)).limit(1))[0]
    : undefined;

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
      <main style={{ maxWidth: 560, margin: "80px auto", padding: "0 24px" }}>
        <h1 style={{ marginBottom: 4 }}>Mola</h1>
        <p style={{ color: "var(--muted)", marginTop: 0 }}>
          Signed in as <strong>{session.email}</strong>, who has no chats yet
          {courseCount === 0 ? " and no courses yet" : ""}.
        </p>
        <a href={courseCount === 0 ? "/courses/new" : "/courses"} style={{
          display: "inline-block", marginTop: 16, padding: "12px 20px", borderRadius: 10,
          background: "var(--accent)", color: "#fff", textDecoration: "none", fontWeight: 600,
        }}>
          {courseCount === 0 ? "Add a course →" : "View your courses →"}
        </a>
      </main>
    );
  }

  return (
    <Chat
      chatId={chat.id}
      chatTitle={chat.title}
      courseName={course ? `${course.number ?? ""} ${course.name}`.trim() : null}
      userName={session.email}
    />
  );
}
