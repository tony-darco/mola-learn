/**
 * POST /api/canvas — create a canvas, returning its id as JSON.
 *
 * The web canvas page creates one through `createCanvasAction` (a Server
 * Action that ends in `redirect(/canvas/:id)`), which a native client can't
 * call. This mirrors that action's insert exactly — same defaults, same
 * ownership — but returns `{ id }` instead of redirecting, the same reason
 * `GET /api/artifacts` exists alongside the page components it parallels.
 */
import { canvasBackgroundPatternSchema, canvasPayloadSchema } from "@mola/shared";
import { artifacts, db } from "@mola/db";
import { authzResponse, requireSession } from "@/lib/auth/ownership";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    const body = (await req.json().catch(() => ({}))) as {
      title?: string;
      backgroundPattern?: string;
      backgroundColor?: string;
    };

    const title = body.title?.trim() || "Untitled canvas";
    const pattern = canvasBackgroundPatternSchema.catch("dots").parse(body.backgroundPattern);
    const color = body.backgroundColor?.trim() || "#ffffff";

    const payload = canvasPayloadSchema.parse({
      kind: "canvas",
      elements: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      background: { pattern, color },
    });

    const [row] = await db
      .insert(artifacts)
      .values({
        userId: session.userId,
        courseId: null,
        originChatId: null,
        kind: "canvas",
        title,
        topics: [],
        sources: [],
        payload,
        version: 1,
      })
      .returning({ id: artifacts.id });

    return Response.json({ id: row!.id });
  } catch (err) {
    return authzResponse(err) ?? Response.json({ error: "internal" }, { status: 500 });
  }
}
