import { desc, eq } from "drizzle-orm";
import { chats, courses, db } from "@mola/db";
import { getSession } from "@/lib/auth/session";
import { Chat } from "./chat";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getSession();
  if (!session) {
    return (
      <main style={{ padding: 40, maxWidth: 640 }}>
        <h1>Mola</h1>
        <p style={{ color: "var(--muted)" }}>
          No dev session. Sign in as a seeded user:
        </p>
        <pre style={{ background: "var(--panel)", padding: 16, borderRadius: 8, overflowX: "auto" }}>
{`curl -c cookies.txt -X POST localhost:3000/api/dev-login \\
  -H 'content-type: application/json' -d '{"email":"alice@umbc.edu"}'`}
        </pre>
      </main>
    );
  }

  const [chat] = await db.select().from(chats)
    .where(eq(chats.userId, session.userId))
    .orderBy(desc(chats.createdAt)).limit(1);

  const course = chat?.courseId
    ? (await db.select().from(courses).where(eq(courses.id, chat.courseId)).limit(1))[0]
    : undefined;

  if (!chat) return <main style={{ padding: 40 }}>No chats seeded. Run <code>pnpm db:seed</code>.</main>;

  return (
    <Chat
      chatId={chat.id}
      chatTitle={chat.title}
      courseName={course ? `${course.number ?? ""} ${course.name}`.trim() : null}
      userName={session.email}
    />
  );
}
