"use server";

/**
 * Server actions backing the mind map viewer/editor. Like every other
 * action in this app, this re-derives the session and checks ownership
 * itself (§9).
 */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { artifacts, db } from "@mola/db";
import { mindMapPayloadSchema, type SourceRef } from "@mola/shared";
import { AuthzError, requireOwned, requireSession } from "@/lib/auth/ownership";

async function requireOwnMindMap(mapId: string, userId: string) {
  const row = await requireOwned("artifact", mapId).catch((err) => {
    if (err instanceof AuthzError) throw new Error("mind map not found");
    throw err;
  });
  if (row.userId !== userId || row.kind !== "mind_map") throw new Error("mind map not found");
  return row;
}

export type NodeInput = {
  id: string; label: string; parentId: string | null; note: string | null;
  sources: SourceRef[];
};
export type EdgeInput = { from: string; to: string; label: string | null };

/**
 * Replaces a mind map's nodes/edges wholesale — simpler than flashcards'/
 * quizzes' id-preservation dance because nothing downstream (no SRS state,
 * no attempt history) is keyed to a node id, so there's nothing to lose by
 * fully replacing the tree on every edit.
 */
export async function updateMindMapAction(
  mapId: string,
  rootId: string,
  nodes: NodeInput[],
  edges: EdgeInput[],
): Promise<void> {
  const session = await requireSession();
  const map = await requireOwnMindMap(mapId, session.userId);

  const payload = mindMapPayloadSchema.parse({ kind: "mind_map", rootId, nodes, edges });

  await db.update(artifacts)
    .set({ payload, version: map.version + 1, updatedAt: new Date() })
    .where(eq(artifacts.id, mapId));

  revalidatePath(`/mindmaps/${mapId}`);
  revalidatePath("/mindmaps");
  revalidatePath("/artifacts");
}
