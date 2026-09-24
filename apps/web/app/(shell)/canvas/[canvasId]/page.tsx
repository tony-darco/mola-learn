import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { artifactRecordSchema } from "@mola/shared";
import { courses, db } from "@mola/db";
import { AuthzError, requireOwned, requireSession } from "@/lib/auth/ownership";
import { CanvasView } from "@/components/chat/CanvasView";
import { CourseBreadcrumb } from "@/components/chat/CourseBreadcrumb";

export const dynamic = "force-dynamic";

/** Ownership-check pattern mirrors the flashcards/quizzes/mindmaps detail pages. */
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

  const courseName = canvas.courseId
    ? (await db.select({ name: courses.name }).from(courses).where(eq(courses.id, canvas.courseId)).limit(1))[0]?.name ?? null
    : null;

  return (
    <main className="flex-1 min-w-0 overflow-y-auto py-8 pl-4 pr-6">
      <div className="mx-auto max-w-full">
        <CourseBreadcrumb courseId={canvas.courseId} courseName={courseName} artifactTitle={canvas.title} />
        <CanvasView canvasId={canvas.id} title={canvas.title} payload={canvas.payload} initialVersion={canvas.version} />
      </div>
    </main>
  );
}
