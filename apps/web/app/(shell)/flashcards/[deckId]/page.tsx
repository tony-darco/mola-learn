import { notFound } from "next/navigation";
import { artifactRecordSchema } from "@mola/shared";
import { AuthzError, requireOwned, requireSession } from "@/lib/auth/ownership";
import { FlashcardStudyView } from "@/components/chat/FlashcardStudyView";

export const dynamic = "force-dynamic";

/** A dedicated page per deck (not a modal) so the sidebar stays visible and
 * the URL is shareable/bookmarkable, mirroring the course detail page's
 * ownership-check pattern. */
export default async function FlashcardDeckPage({ params }: { params: Promise<{ deckId: string }> }) {
  const { deckId } = await params;
  const session = await requireSession();

  const row = await requireOwned("artifact", deckId, session).catch((err) => {
    if (err instanceof AuthzError) notFound();
    throw err;
  });

  if (row.kind !== "flashcard_deck") notFound();

  const deck = artifactRecordSchema.parse(row);
  if (deck.payload.kind !== "flashcard_deck") notFound();

  return (
    <main className="flex-1 min-w-0 overflow-y-auto py-8 pl-4 pr-6">
      <div className="mx-auto max-w-5xl">
        <FlashcardStudyView deckId={deck.id} title={deck.title} cards={deck.payload.cards} />
      </div>
    </main>
  );
}
