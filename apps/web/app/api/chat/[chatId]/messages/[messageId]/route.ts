/**
 * DELETE: truncates a chat back to just before the given message — every
 * message (and any artifact) at or after its createdAt is removed. Backs the
 * chat surface's retry affordance (testing-support feature, not yet the
 * shipped design): a retry always discards the old context from this point
 * forward and resends fresh, never reuses the prior output.
 */
import { and, eq, gte } from "drizzle-orm";
import { artifacts, db, messages } from "@mola/db";
import { authzResponse, requireOwned } from "@/lib/auth/ownership";

export async function DELETE(
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

    await db.delete(messages)
      .where(and(eq(messages.chatId, chatId), gte(messages.createdAt, message.createdAt)));

    await db.delete(artifacts)
      .where(and(eq(artifacts.originChatId, chatId), gte(artifacts.createdAt, message.createdAt)));

    return new Response(null, { status: 204 });
  } catch (err) {
    return authzResponse(err) ?? Response.json({ error: "internal" }, { status: 500 });
  }
}
