/**
 * Contract D — `PATCH /api/calendar/events/:id`, the homework check-off path.
 *
 * `completedAt` is sent by the client rather than stamped server-side because
 * the calendar's optimistic update has to render a timestamp before the round
 * trip returns; the value is normalised here so a bad string can't land in the
 * column, and the response re-projects the stored row so the client reconciles
 * against what was actually written.
 */
import { eq } from "drizzle-orm";
import { db, scheduleItems } from "@mola/db";
import { authzResponse, requireOwned, requireSession } from "@/lib/auth/ownership";
import { getCalendarEvent } from "../query";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireSession();

    // §9 — before any work, on every request.
    await requireOwned("scheduleItem", id, session);

    const body = (await req.json().catch(() => ({}))) as { completedAt?: string | null };
    if (!("completedAt" in body)) {
      return Response.json({ error: "completedAt is required" }, { status: 400 });
    }

    let completedAt: Date | null = null;
    if (body.completedAt != null) {
      completedAt = new Date(body.completedAt);
      if (Number.isNaN(completedAt.getTime())) {
        return Response.json({ error: "completedAt must be an ISO timestamp or null" }, { status: 400 });
      }
    }

    await db.update(scheduleItems)
      .set({ completedAt, updatedAt: new Date() })
      .where(eq(scheduleItems.id, id));

    const event = await getCalendarEvent(session.userId, id);
    if (!event) return Response.json({ error: "scheduleItem not found" }, { status: 404 });

    return Response.json({ event });
  } catch (err) {
    return authzResponse(err) ?? Response.json({ error: "internal" }, { status: 500 });
  }
}
