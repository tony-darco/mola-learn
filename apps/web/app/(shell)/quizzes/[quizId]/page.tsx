import { notFound } from "next/navigation";
import { artifactRecordSchema } from "@mola/shared";
import { AuthzError, requireOwned, requireSession } from "@/lib/auth/ownership";
import { QuizStudyView } from "@/components/chat/QuizStudyView";

export const dynamic = "force-dynamic";

/** Ownership-check pattern mirrors app/(shell)/flashcards/[deckId]/page.tsx. */
export default async function QuizDetailPage({ params }: { params: Promise<{ quizId: string }> }) {
  const { quizId } = await params;
  const session = await requireSession();

  const row = await requireOwned("artifact", quizId, session).catch((err) => {
    if (err instanceof AuthzError) notFound();
    throw err;
  });

  if (row.kind !== "quiz") notFound();

  const quiz = artifactRecordSchema.parse(row);
  if (quiz.payload.kind !== "quiz") notFound();

  return (
    <main className="flex-1 min-w-0 overflow-y-auto py-8 pl-4 pr-6">
      <div className="mx-auto max-w-3xl">
        <QuizStudyView quizId={quiz.id} title={quiz.title} courseId={quiz.courseId} questions={quiz.payload.questions} />
      </div>
    </main>
  );
}
