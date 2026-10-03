/**
 * The canvas chat's edit log, brought up to the canvas as saved — the panel
 * calls this after each save that went through, and gets back the entries
 * written or rewritten (lib/canvas/chatServer.ts syncEditLog).
 *
 * Its own request, not part of saveCanvasAction: reading the board takes
 * about half a second to a second on a full board (readCanvas), and a save
 * must not wait for that. Not a server action either — those run one at a
 * time per page, so the next save would queue behind it.
 *
 * Only the caller's own chat for the canvas gets entries, and only once it
 * exists: a first message reads the whole board anyway.
 */
import { eq } from "drizzle-orm";
import { artifacts, db } from "@mola/db";
import { authzResponse, requireSession } from "@/lib/auth/ownership";
import type { CanvasEditsResponse } from "@/lib/canvas/chat";
import { findCanvasChat, lockChat, requireOwnCanvas, syncEditLog, toClientMessage } from "@/lib/canvas/chatServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ canvasId: string }> }) {
  try {
    const { canvasId } = await params;
    const session = await requireSession();
    await requireOwnCanvas(canvasId, session);

    const chat = await findCanvasChat(canvasId, session.userId);
    if (!chat) return Response.json({ chatId: null, entries: [] } satisfies CanvasEditsResponse);

    const written = await db.transaction(async (tx) => {
      const locked = await lockChat(tx, chat.id);
      const [canvas] = await tx.select({ payload: artifacts.payload, version: artifacts.version }).from(artifacts).where(eq(artifacts.id, canvasId));
      return (await syncEditLog(tx, locked, canvas!)).written;
    });
    return Response.json({ chatId: chat.id, entries: written.map(toClientMessage) } satisfies CanvasEditsResponse);
  } catch (err) {
    return authzResponse(err) ?? Response.json({ error: "internal" }, { status: 500 });
  }
}
