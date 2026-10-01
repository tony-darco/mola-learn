import { and, desc, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { chats, db } from "@mola/db";
import { getSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** "Chats" nav landing: jump to the most recent chat, or offer to start one. */
export default async function ChatsIndexPage() {
  const session = await getSession();
  if (!session) return null; // ShellLayout already redirected; unreachable in practice.

  // Not a canvas's own chat — that lives in the canvas's chat panel.
  const [mostRecent] = await db.select().from(chats)
    .where(and(eq(chats.userId, session.userId), isNull(chats.canvasId)))
    .orderBy(desc(chats.updatedAt)).limit(1);

  if (mostRecent) redirect(`/chats/${mostRecent.id}`);

  return (
    <main className="chat-main flex items-center justify-center">
      <p className="max-w-sm text-center text-fg-muted">
        No chats yet. Start one from the sidebar on any course, or ask Mola something general.
      </p>
    </main>
  );
}
