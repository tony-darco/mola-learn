/**
 * POST /api/plan/:id/amend — contract D. The "amend" in propose → amend →
 * accept.
 *
 * The body is validated here rather than trusted into `applyAmendment`,
 * because an amendment is student input that ends up in a jsonb column the
 * end-of-week review will later read as evidence. `before`/`after` stay
 * `unknown` on purpose — their shape depends on the action, and the payload
 * module is what knows the difference.
 */
import { z } from "zod";
import { requireSession } from "@/lib/auth/ownership";
import { amendPlan, AMENDMENT_ACTIONS } from "@/lib/planning";
import { planningErrorResponse } from "@/lib/planning/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  amendments: z.array(z.object({
    itemId: z.string().min(1).nullable().optional(),
    action: z.enum(AMENDMENT_ACTIONS),
    before: z.unknown().optional(),
    after: z.unknown().optional(),
    reason: z.string().nullable().optional(),
  })).min(1),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ planId: string }> },
) {
  try {
    const session = await requireSession();
    const { planId } = await params;

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
        { status: 400 },
      );
    }

    return Response.json({ plan: await amendPlan(session, planId, parsed.data.amendments) });
  } catch (err) {
    return planningErrorResponse(err);
  }
}
