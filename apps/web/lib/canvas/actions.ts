"use server";

/**
 * Server actions backing the canvas viewer/editor. Like every other action
 * in this app, this re-derives the session and checks ownership itself (§9).
 */
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { artifacts, db } from "@mola/db";
import { canvasBackgroundPatternSchema, canvasPayloadSchema, type CanvasElement } from "@mola/shared";
import { AuthzError, requireOwned, requireSession } from "@/lib/auth/ownership";

async function requireOwnCanvas(canvasId: string, userId: string) {
  const row = await requireOwned("artifact", canvasId).catch((err) => {
    if (err instanceof AuthzError) throw new Error("canvas not found");
    throw err;
  });
  if (row.userId !== userId || row.kind !== "canvas") throw new Error("canvas not found");
  return row;
}

export type SaveCanvasResult =
  | { ok: true; version: number }
  | { ok: false; currentVersion: number };

/**
 * Optimistic concurrency, for real this time — updateMindMapAction never
 * actually checks version before writing (pure last-write-wins); this is
 * the first place in the codebase to enforce the CAS check the `version`
 * column was always meant for. The WHERE clause re-checks version at the
 * SQL level too, closing the race between the SELECT above and this UPDATE.
 */
export async function saveCanvasAction(
  canvasId: string,
  elements: CanvasElement[],
  viewport: { x: number; y: number; zoom: number },
  background: { pattern: z.infer<typeof canvasBackgroundPatternSchema>; color: string },
  expectedVersion: number,
): Promise<SaveCanvasResult> {
  const session = await requireSession();
  const row = await requireOwnCanvas(canvasId, session.userId);

  if (row.version !== expectedVersion) {
    return { ok: false, currentVersion: row.version };
  }

  const payload = canvasPayloadSchema.parse({ kind: "canvas", elements, viewport, background });

  const result = await db
    .update(artifacts)
    .set({ payload, version: row.version + 1, updatedAt: new Date() })
    .where(and(eq(artifacts.id, canvasId), eq(artifacts.version, expectedVersion)))
    .returning({ version: artifacts.version });

  if (result.length === 0) {
    const [fresh] = await db.select({ version: artifacts.version }).from(artifacts).where(eq(artifacts.id, canvasId)).limit(1);
    return { ok: false, currentVersion: fresh?.version ?? row.version };
  }

  // Not revalidatePath(`/canvas/${canvasId}`) — the client holds live local
  // state while editing; forcing an RSC refetch of the page being actively
  // edited every 800-1200ms is pure churn. /artifacts is a different,
  // not-currently-open page, so keeping its preview/edited-time fresh is
  // low-cost.
  revalidatePath("/artifacts");
  return { ok: true, version: result[0]!.version };
}

/** Insert-then-redirect, same shape as uploadCourseDocumentAction in lib/courses/actions.ts. */
export async function createCanvasAction(formData: FormData): Promise<void> {
  const session = await requireSession();

  const rawName = formData.get("name");
  const title = typeof rawName === "string" && rawName.trim().length > 0 ? rawName.trim() : "Untitled canvas";
  const pattern = canvasBackgroundPatternSchema.catch("dots").parse(formData.get("backgroundPattern"));
  const rawColor = formData.get("backgroundColor");
  const color = typeof rawColor === "string" && rawColor.length > 0 ? rawColor : "#ffffff";

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

  redirect(`/canvas/${row!.id}`);
}
