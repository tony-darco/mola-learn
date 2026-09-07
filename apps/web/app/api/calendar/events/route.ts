/**
 * Contract D — `GET /api/calendar/events?from=<ISO>&to=<ISO>&courseId=<uuid?>`.
 *
 * The calendar UI refetches this on every navigation, so the window is a
 * required parameter rather than a default: an unbounded read of a four-year
 * schedule is not something a missing query string should be able to ask for.
 */
import { authzResponse, requireSession } from "@/lib/auth/ownership";
import { listCalendarEvents } from "./query";

export const dynamic = "force-dynamic";

function parseInstant(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET(req: Request) {
  try {
    const session = await requireSession();
    const params = new URL(req.url).searchParams;

    const from = parseInstant(params.get("from"));
    const to = parseInstant(params.get("to"));
    if (!from || !to) {
      return Response.json({ error: "from and to must be ISO timestamps" }, { status: 400 });
    }
    if (to <= from) {
      return Response.json({ error: "to must be after from" }, { status: 400 });
    }

    // A foreign courseId needs no ownership check of its own: the query is
    // already scoped by userId, so filtering on someone else's course returns
    // an empty list rather than leaking whether that course exists (§9).
    const events = await listCalendarEvents(session.userId, {
      from, to, courseId: params.get("courseId"),
    });

    return Response.json({ events });
  } catch (err) {
    return authzResponse(err) ?? Response.json({ error: "internal" }, { status: 500 });
  }
}
