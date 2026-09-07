/**
 * PATCH /api/tasks/:id — contract D.
 *
 * `completedAt` is deliberately not accepted from the body. When work happened
 * is a fact the server records, not one the client asserts, and the same rule
 * is what makes the `completed` amendment written alongside it trustworthy as
 * evidence for the end-of-week review.
 */
import { z } from "zod";
import { requireSession } from "@/lib/auth/ownership";
import { updateTask } from "@/lib/planning";
import { planningErrorResponse } from "@/lib/planning/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  status: z.enum(["todo", "done", "skipped"]).optional(),
  title: z.string().min(1).optional(),
  notes: z.string().nullable().optional(),
  scheduledFor: z.string().datetime({ offset: true }).nullable().optional(),
  estimatedMinutes: z.number().int().positive().nullable().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const session = await requireSession();
    const { taskId } = await params;

    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
        { status: 400 },
      );
    }

    return Response.json({ task: await updateTask(session, taskId, parsed.data) });
  } catch (err) {
    return planningErrorResponse(err);
  }
}
