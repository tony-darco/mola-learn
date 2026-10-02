/**
 * PATCH /api/canvas/:canvasId — save a canvas's elements/viewport/background.
 *
 * Unlike `/api/canvas` (POST, create), this calls `saveCanvasAction` directly
 * rather than re-deriving its logic: that action never redirects — it's a
 * plain async function returning a value — so it's safe to invoke from a
 * route handler, and doing so keeps the optimistic-concurrency check (the
 * `version` compare-and-swap) in exactly one place rather than two copies
 * that could drift.
 */
import { z } from "zod";
import { canvasBackgroundPatternSchema, canvasElementSchema } from "@mola/shared";
import { authzResponse, requireSession } from "@/lib/auth/ownership";
import { saveCanvasAction } from "@/lib/canvas/actions";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  elements: z.array(canvasElementSchema),
  viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number().positive() }),
  background: z.object({ pattern: canvasBackgroundPatternSchema, color: z.string().min(1) }),
  expectedVersion: z.number().int().positive(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ canvasId: string }> },
) {
  try {
    await requireSession();
    const { canvasId } = await params;

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return Response.json({ error: "bad request" }, { status: 400 });
    }
    const { elements, viewport, background, expectedVersion } = parsed.data;

    const result = await saveCanvasAction(canvasId, elements, viewport, background, expectedVersion);
    return Response.json(result);
  } catch (err) {
    return authzResponse(err) ?? Response.json({ error: err instanceof Error ? err.message : "internal" }, { status: 500 });
  }
}
