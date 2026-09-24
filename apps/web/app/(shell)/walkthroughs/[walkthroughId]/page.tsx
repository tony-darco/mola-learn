import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { artifactRecordSchema } from "@mola/shared";
import { courses, db } from "@mola/db";
import { AuthzError, requireOwned, requireSession } from "@/lib/auth/ownership";
import { WalkthroughView } from "@/components/chat/WalkthroughView";
import { CourseBreadcrumb } from "@/components/chat/CourseBreadcrumb";

export const dynamic = "force-dynamic";

/** Ownership-check pattern mirrors the flashcards/quizzes/mindmaps detail pages. */
export default async function WalkthroughDetailPage({ params }: { params: Promise<{ walkthroughId: string }> }) {
  const { walkthroughId } = await params;
  const session = await requireSession();

  const row = await requireOwned("artifact", walkthroughId, session).catch((err) => {
    if (err instanceof AuthzError) notFound();
    throw err;
  });

  if (row.kind !== "walkthrough") notFound();

  const walkthrough = artifactRecordSchema.parse(row);
  if (walkthrough.payload.kind !== "walkthrough") notFound();

  const courseName = walkthrough.courseId
    ? (await db.select({ name: courses.name }).from(courses).where(eq(courses.id, walkthrough.courseId)).limit(1))[0]?.name ?? null
    : null;

  return (
    <main className="flex-1 min-w-0 overflow-y-auto py-8 pl-4 pr-6">
      <div className="mx-auto max-w-5xl">
        <CourseBreadcrumb courseId={walkthrough.courseId} courseName={courseName} artifactTitle={walkthrough.title} />
        <WalkthroughView payload={walkthrough.payload} title={walkthrough.title} />
      </div>
    </main>
  );
}
