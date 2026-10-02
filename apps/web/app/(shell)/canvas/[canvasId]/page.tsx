import { notFound } from "next/navigation";
import { artifactRecordSchema } from "@mola/shared";
import { AuthzError, requireOwned, requireSession } from "@/lib/auth/ownership";
import { CanvasView } from "@/components/chat/CanvasView";

export const dynamic = "force-dynamic";

/** Ownership-check pattern mirrors the flashcards/quizzes/mindmaps detail pages.
 * Unlike those, canvas fills the entire main pane edge-to-edge — an infinite
 * whiteboard has no use for a breadcrumb or reading-width padding, and going
 * back is what the sidebar is for. */
export default async function CanvasDetailPage({ params }: { params: Promise<{ canvasId: string }> }) {
  const { canvasId } = await params;
  const session = await requireSession();

  const row = await requireOwned("artifact", canvasId, session).catch((err) => {
    if (err instanceof AuthzError) notFound();
    throw err;
  });

  if (row.kind !== "canvas") notFound();

  const canvas = artifactRecordSchema.parse(row);
  if (canvas.payload.kind !== "canvas") notFound();

  return (
    <main className="flex flex-1 min-w-0 overflow-hidden">
      <CanvasView canvasId={canvas.id} title={canvas.title} payload={canvas.payload} initialVersion={canvas.version} />
    </main>
  );
}
