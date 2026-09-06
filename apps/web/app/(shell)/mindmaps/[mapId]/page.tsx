import { notFound } from "next/navigation";
import { artifactRecordSchema } from "@mola/shared";
import { AuthzError, requireOwned, requireSession } from "@/lib/auth/ownership";
import { MindMapView } from "@/components/chat/MindMapView";

export const dynamic = "force-dynamic";

/** Ownership-check pattern mirrors the flashcards/quizzes detail pages. */
export default async function MindMapDetailPage({ params }: { params: Promise<{ mapId: string }> }) {
  const { mapId } = await params;
  const session = await requireSession();

  const row = await requireOwned("artifact", mapId, session).catch((err) => {
    if (err instanceof AuthzError) notFound();
    throw err;
  });

  if (row.kind !== "mind_map") notFound();

  const map = artifactRecordSchema.parse(row);
  if (map.payload.kind !== "mind_map") notFound();

  return (
    <main className="flex-1 min-w-0 overflow-y-auto py-8 pl-4 pr-6">
      <div className="mx-auto max-w-5xl">
        <MindMapView mapId={map.id} title={map.title} payload={map.payload} />
      </div>
    </main>
  );
}
