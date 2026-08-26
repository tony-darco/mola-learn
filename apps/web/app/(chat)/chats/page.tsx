import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { chats, db } from "@mola/db";
import { getSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** "Chats" nav landing: jump to the most recent chat, or offer to start one. */
export default async function ChatsIndexPage() {
  const session = await getSession();
  if (!session) {
    return (
      <main style={{ maxWidth: 560, margin: "80px auto", padding: "0 24px" }}>
        <h1 style={{ marginBottom: 4 }}>Mola</h1>
        <p style={{ color: "var(--muted)", marginTop: 0 }}>Not signed in.</p>
        <a href="/dev-signin">Pick a dev user →</a>
      </main>
    );
  }

  const [mostRecent] = await db.select().from(chats)
    .where(eq(chats.userId, session.userId))
    .orderBy(desc(chats.updatedAt)).limit(1);

  if (mostRecent) redirect(`/chats/${mostRecent.id}`);

  return (
    <main style={{ maxWidth: 560, margin: "80px auto", padding: "0 24px" }}>
      <h1 style={{ marginBottom: 4 }}>Mola</h1>
      <p style={{ color: "var(--muted)", marginTop: 0 }}>
        No chats yet. Start one from the sidebar on any course, or ask Mola something general.
      </p>
    </main>
  );
}
