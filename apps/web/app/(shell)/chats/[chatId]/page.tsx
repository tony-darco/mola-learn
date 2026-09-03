import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { AuthzError, requireOwned } from "@/lib/auth/ownership";
import { ChatMain } from "@/components/chat/ChatMain";

export const dynamic = "force-dynamic";

/**
 * A navigable per-chat URL — the sidebar links here. Mirrors the §9 ownership
 * boundary exactly the way app/(shell)/page.tsx does for the single most-recent
 * chat: someone else's chat id is a 404 (never a peek). Being signed in at all
 * is already guaranteed by ShellLayout.
 */
export default async function ChatPage({ params }: { params: Promise<{ chatId: string }> }) {
  const { chatId } = await params;
  const session = await getSession();
  if (!session) return null; // ShellLayout already redirected; unreachable in practice.

  try {
    await requireOwned("chat", chatId, session);
  } catch (err) {
    if (err instanceof AuthzError && err.status === 404) notFound();
    throw err;
  }

  return <ChatMain chatId={chatId} />;
}
