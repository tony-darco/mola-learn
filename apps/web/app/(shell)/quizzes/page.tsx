import { requireSession } from "@/lib/auth/ownership";
import { listCoursesForFilters, listQuizzes, listTermsForFilters } from "@/lib/quizzes/gallery";
import { QuizzesGallery } from "@/components/chat/QuizzesGallery";

export const dynamic = "force-dynamic";

/** Server component: ownership-scoped reads, handed to the client gallery.
 * Mirrors app/(shell)/flashcards/page.tsx exactly. */
export default async function QuizzesPage() {
  const session = await requireSession();

  const [quizzes, courses, terms] = await Promise.all([
    listQuizzes(session.userId),
    listCoursesForFilters(session.userId),
    listTermsForFilters(session.userId),
  ]);

  const clientQuizzes = quizzes.map((q) => ({
    ...q,
    createdAt: q.createdAt.toISOString(),
    updatedAt: q.updatedAt.toISOString(),
  }));

  return (
    <main className="flex-1 min-w-0 overflow-y-auto py-8 pl-4 pr-6">
      <div className="mx-auto max-w-7xl">
        <QuizzesGallery quizzes={clientQuizzes} courses={courses} terms={terms} />
      </div>
    </main>
  );
}
