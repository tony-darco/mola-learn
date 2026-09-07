import { eq } from "drizzle-orm";
import { courses, db, users } from "@mola/db";
import { getSession } from "@/lib/auth/session";
import { getPublicApiKey } from "@/lib/auth/api-keys";
import { NewCourseChatComposer } from "@/components/chat/NewCourseChatComposer";
import { NextUpPanel } from "@/components/chat/NextUpPanel";
import { parseScenario } from "@/components/plan/fixtures";

export const dynamic = "force-dynamic";

/** The app's landing screen — always a fresh "start a new chat" prompt, not the last conversation. */
export default async function ChatLandingPage({
  searchParams,
}: {
  searchParams: Promise<{ fixtures?: string }>;
}) {
  const session = await getSession();
  if (!session) return null; // ShellLayout already redirected; unreachable in practice.

  const [[user], ownKey, userCourses, { fixtures }] = await Promise.all([
    db.select({
      defaultModel: users.defaultModel, defaultThinkingEnabled: users.defaultThinkingEnabled,
    }).from(users).where(eq(users.id, session.userId)).limit(1),
    getPublicApiKey(session.userId),
    db.select({ id: courses.id, name: courses.name, number: courses.number })
      .from(courses).where(eq(courses.userId, session.userId)),
    searchParams,
  ]);

  return (
    <main className="chat-main flex flex-col items-center justify-center pb-40">
      <div className="w-full max-w-2xl px-6">
        <h1 className="mb-8 text-center text-4xl font-semibold text-fg">Ready to get started</h1>
        {/* Renders nothing when there is nothing worth interrupting for, so
            the landing screen stays a composer on a quiet day. */}
        <NextUpPanel
          courses={userCourses}
          fixtures={process.env.NODE_ENV === "production" ? null : parseScenario(fixtures)}
        />
        <NewCourseChatComposer
          placeholder="Ask something, or pick a course from the sidebar…"
          defaultModel={user?.defaultModel}
          defaultThinkingEnabled={user ? user.defaultThinkingEnabled === 1 : undefined}
          hasOwnKey={ownKey !== null}
        />
      </div>
    </main>
  );
}
