/**
 * POST: the only way a turn's generation is ever cancelled early.
 *
 * Generation lifetime is deliberately decoupled from the POSTing request's
 * own connection (see /api/chat/[chatId]/route.ts and generation-registry.ts)
 * so a client disconnect — a navigation away, a closed tab — never aborts a
 * turn by accident. The Stop button calls this endpoint explicitly instead.
 */
import { authzResponse, requireOwned } from "@/lib/auth/ownership";
import { stopGeneration } from "@/lib/chat/generation-registry";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ chatId: string; messageId: string }> },
) {
  try {
    const { chatId, messageId } = await params;
    await requireOwned("chat", chatId);
    const message = await requireOwned("message", messageId);

    if (message.chatId !== chatId) {
      return Response.json({ error: "message does not belong to this chat" }, { status: 400 });
    }

    const stopped = stopGeneration(messageId);
    return Response.json({ stopped });
  } catch (err) {
    return authzResponse(err) ?? Response.json({ error: "internal" }, { status: 500 });
  }
}
