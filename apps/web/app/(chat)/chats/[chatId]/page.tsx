import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { courses, db } from "@mola/db";
import { getSession } from "@/lib/auth/session";
import { AuthzError, requireOwned } from "@/lib/auth/ownership";
import { ChatShell } from "@/components/chat/ChatShell";

export const dynamic = "force-dynamic";

/**
 * A navigable per-chat URL — the sidebar links here. Mirrors the §9 ownership
 * boundary exactly the way app/page.tsx does for the single most-recent chat:
 * logged out is a plain message, someone else's chat id is a 404 (never a peek).
 */
export default async function ChatPage({ params }: { params: Promise<{ chatId: string }> }) {
  const { chatId } = await params;
  const session = await getSession();

  if (!session) {
    return (
      <main style={{ maxWidth: 560, margin: "80px auto", padding: "0 24px" }}>
        <h1 style={{ marginBottom: 4 }}>Mola</h1>
        <p style={{ color: "var(--muted)", marginTop: 0 }}>
          Not signed in. There are no passwords yet — authentication is Phase 1 work.
        </p>
        <a href="/dev-signin" style={{
          display: "inline-block", marginTop: 16, padding: "12px 20px", borderRadius: 10,
          background: "var(--accent)", color: "#fff", textDecoration: "none", fontWeight: 600,
        }}>
          Pick a dev user →
        </a>
      </main>
    );
  }

  let chat;
  try {
    chat = await requireOwned("chat", chatId, session);
  } catch (err) {
    if (err instanceof AuthzError && err.status === 404) notFound();
    throw err;
  }

  const course = chat.courseId
    ? (await db.select().from(courses).where(eq(courses.id, chat.courseId)).limit(1))[0]
    : undefined;

  return (
    <ChatShell
      chatId={chat.id}
      initialTitle={chat.title}
      initialCourseId={chat.courseId}
      initialCourseName={course ? `${course.number ?? ""} ${course.name}`.trim() : null}
      userName={session.email}
    />
  );
}
