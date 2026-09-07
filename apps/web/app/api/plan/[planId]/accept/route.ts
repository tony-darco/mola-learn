/**
 * POST /api/plan/:id/accept — contract D. The gate closing (§5).
 *
 * `acceptPlan` stamps `approvedAt`, materialises the payload into tasks
 * idempotently on `(planId, planItemId)`, and supersedes whatever this plan
 * replaces. Ownership is checked inside it, through `requireOwned` — a plan id
 * is not a capability (§9).
 */
import { requireSession } from "@/lib/auth/ownership";
import { acceptPlan } from "@/lib/planning";
import { planningErrorResponse } from "@/lib/planning/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ planId: string }> },
) {
  try {
    const session = await requireSession();
    const { planId } = await params;
    return Response.json({ plan: await acceptPlan(session, planId) });
  } catch (err) {
    return planningErrorResponse(err);
  }
}
