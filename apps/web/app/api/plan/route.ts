/**
 * GET /api/plan?horizon=day|week|semester&date=YYYY-MM-DD — contract D.
 *
 * Returns the plan in force for that horizon and date, proposed or approved,
 * or null. A pending proposal wins over the approved plan behind it on purpose:
 * §5 says an unanswered proposal is "presented on next open — before anything
 * else happens", and this endpoint is where the Plan tab finds out.
 */
import { requireSession } from "@/lib/auth/ownership";
import { getCurrentPlan, type PlanHorizon } from "@/lib/planning";
import { isDateKey } from "@/lib/planning/dates";
import { planningErrorResponse } from "@/lib/planning/errors";

export const dynamic = "force-dynamic";

const HORIZONS: readonly PlanHorizon[] = ["day", "week", "semester"];

export async function GET(req: Request) {
  try {
    const session = await requireSession();
    const params = new URL(req.url).searchParams;

    const horizon = params.get("horizon");
    if (!isHorizon(horizon)) {
      return Response.json({ error: "horizon must be day, week or semester" }, { status: 400 });
    }

    const date = params.get("date");
    if (date !== null && !isDateKey(date)) {
      return Response.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
    }

    return Response.json({ plan: await getCurrentPlan(session, horizon, date) });
  } catch (err) {
    return planningErrorResponse(err);
  }
}

function isHorizon(value: unknown): value is PlanHorizon {
  return HORIZONS.includes(value as PlanHorizon);
}
