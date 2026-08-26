import { desc, eq } from "drizzle-orm";
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
          Not signed in. There are no passwords yet — authentication is Phase 1 work.
        </p>
        <a
          href="/dev-signin"
          style={{
            display: "inline-block", marginTop: 16, padding: "12px 20px",
            borderRadius: 10, background: "var(--accent)", color: "#fff",
            textDecoration: "none", fontWeight: 600,
          }}
        >
          Pick a dev user →
        </a>
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
    // Not an error: the seed gives chats to Alice only, so Bob landing here is
    // the §9 ownership model working — he owns nothing and sees nothing.
    return (
      <main style={{ maxWidth: 560, margin: "80px auto", padding: "0 24px" }}>
        <h1 style={{ marginBottom: 4 }}>Mola</h1>
        <p style={{ color: "var(--muted)", marginTop: 0 }}>
          Signed in as <strong>{session.email}</strong>, who has no courses or chats.
          The seed gives those to <code>alice@umbc.edu</code> only — so this empty page
          is the ownership check working, not a missing seed.
        </p>
        <a href="/dev-signin" style={{
          display: "inline-block", marginTop: 16, padding: "12px 20px", borderRadius: 10,
          background: "var(--accent)", color: "#fff", textDecoration: "none", fontWeight: 600,
        }}>
          Switch user →
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
