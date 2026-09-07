import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { artifactRecordSchema } from "@mola/shared";
import { courses, db } from "@mola/db";
import { AuthzError, requireOwned, requireSession } from "@/lib/auth/ownership";
import { MindMapView } from "@/components/chat/MindMapView";
import { CourseBreadcrumb } from "@/components/chat/CourseBreadcrumb";

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

  const courseName = map.courseId
    ? (await db.select({ name: courses.name }).from(courses).where(eq(courses.id, map.courseId)).limit(1))[0]?.name ?? null
    : null;

  return (
    <main className="flex-1 min-w-0 overflow-y-auto py-8 pl-4 pr-6">
      <div className="mx-auto max-w-5xl">
        <CourseBreadcrumb courseId={map.courseId} courseName={courseName} artifactTitle={map.title} />
        <MindMapView mapId={map.id} title={map.title} payload={map.payload} />
      </div>
    </main>
  );
}
