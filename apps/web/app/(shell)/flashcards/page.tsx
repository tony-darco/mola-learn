import { requireSession } from "@/lib/auth/ownership";
import { listCoursesForFilters, listFlashcardDecks, listTermsForFilters } from "@/lib/flashcards/gallery";
import { FlashcardsGallery } from "@/components/chat/FlashcardsGallery";

export const dynamic = "force-dynamic";

/**
 * Server component: does the ownership-scoped reads, hands the result to a
 * client component for the interactive gallery (search/filter/sort/preview).
 * Mirrors the pattern in app/(shell)/courses/[id]/page.tsx.
 */
export default async function FlashcardsPage() {
  const session = await requireSession();

  const [decks, courses, terms] = await Promise.all([
    listFlashcardDecks(session.userId),
    listCoursesForFilters(session.userId),
    listTermsForFilters(session.userId),
  ]);

  // Dates cross the server/client boundary as ISO strings, not Date objects —
  // same convention as ShellLayout → AppShell (see app/(shell)/layout.tsx).
  const clientDecks = decks.map((d) => ({
    ...d,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  }));

  return (
    <main className="flex-1 min-w-0 overflow-y-auto py-8 pl-4 pr-6">
      <div className="mx-auto max-w-7xl">
        <FlashcardsGallery decks={clientDecks} courses={courses} terms={terms} />
      </div>
    </main>
  );
}
