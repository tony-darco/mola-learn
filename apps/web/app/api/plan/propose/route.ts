/**
 * POST /api/plan/propose — contract D, which allows either `202 { queued }` or
 * `200 { plan }`. This generates inline and returns the plan.
 *
 * The queued shape was the tempting one, since the generation genuinely takes
 * a minute against a 27B and the job worker already exists. It loses on one
 * detail: `enqueueJob` (contract 8, frozen) skips a kind that is already
 * pending for the user, and `ensurePlansForToday` enqueues exactly these kinds
 * on every app open. A student pressing "re-plan my week" a moment after
 * opening the app would get a 202 for a job that had already been dropped, and
 * then a proposal that never changed — a silent no-op on an explicit request.
 *
 * The other half of the reason is that the two callers genuinely differ. The
 * job declines to overwrite a proposal the student has not answered, because a
 * background worker rewriting what they are still reading is a bug. Here they
 * ARE the one asking, so a re-propose regenerates in place, keeping the plan's
 * id so the link they are already looking at stays live.
 */
import { requireSession } from "@/lib/auth/ownership";
import { proposePlan, type PlanHorizon } from "@/lib/planning";
import { isDateKey } from "@/lib/planning/dates";
import { planningErrorResponse } from "@/lib/planning/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const HORIZONS: readonly PlanHorizon[] = ["day", "week", "semester"];

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    const body = (await req.json().catch(() => ({}))) as { horizon?: unknown; date?: unknown };

    if (!HORIZONS.includes(body.horizon as PlanHorizon)) {
      return Response.json({ error: "horizon must be day, week or semester" }, { status: 400 });
    }
    if (body.date !== undefined && body.date !== null && !isDateKey(body.date)) {
      return Response.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
    }

    const plan = await proposePlan({
      session,
      horizon: body.horizon as PlanHorizon,
      date: (body.date as string | undefined) ?? null,
    });

    return Response.json({ plan });
  } catch (err) {
    return planningErrorResponse(err);
  }
}
