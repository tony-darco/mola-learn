"use server";

/**
 * Renames any artifact kind, ownership-checked. Shared by the Quizzes and
 * (soon) Mind Maps galleries/detail pages — Flashcards keeps its own
 * renameDeckAction (lib/flashcards/actions.ts) since it predates this
 * extraction and there was nothing wrong with it to justify touching it.
 */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { artifacts, db } from "@mola/db";
import { requireSession } from "@/lib/auth/ownership";
import type { ArtifactKind } from "@mola/shared";

export async function renameArtifactAction(
  artifactId: string,
  title: string,
  expectedKind: ArtifactKind,
  galleryPath: string,
): Promise<void> {
  const session = await requireSession();
  const trimmed = title.trim();
  if (!trimmed) return; // an empty title is a no-op, not a way to erase the name

  const [row] = await db.select().from(artifacts).where(eq(artifacts.id, artifactId)).limit(1);
  if (!row || row.userId !== session.userId || row.kind !== expectedKind) return;

  await db.update(artifacts).set({ title: trimmed, updatedAt: new Date() }).where(eq(artifacts.id, artifactId));

  revalidatePath(`${galleryPath}/${artifactId}`);
  revalidatePath(galleryPath);
}
