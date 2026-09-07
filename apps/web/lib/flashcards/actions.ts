"use server";

/**
 * Server actions backing the Flashcards study UI. Like every other action in
 * this app, this re-derives the session and checks ownership itself — a
 * server action is just another request handler (§9).
 */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { artifacts, cardSrsState, db, flashcards } from "@mola/db";
import { flashcardDeckPayloadSchema } from "@mola/shared";
import { AuthzError, requireOwned, requireSession } from "@/lib/auth/ownership";
import { scheduleReview, type SrsRating, type SrsState } from "@/lib/agent/srs";

/** Learn mode's three buttons, mapped onto the scheduler's rating scale. */
const RATING_FOR_GRADE: Record<"yes" | "close" | "no", SrsRating> = {
  yes: "good",
  close: "hard",
  no: "again",
};

/**
 * Records one Learn-mode self-grade against the card's real FSRS state — the
 * same `card_srs_state` row the chat-driven quiz mode writes, so studying in
 * either surface moves the same schedule.
 *
 * Note this is the *persisted* half only. Learn mode's requeueing (a missed
 * card coming back around later in the same sitting) is session-local and
 * never touches the deck or this table.
 */
export async function recordLearnGradeAction(cardId: string, grade: "yes" | "close" | "no"): Promise<void> {
  const session = await requireSession();

  // Ownership: the card itself must belong to the caller. Checked against
  // `flashcards`, not `card_srs_state`, so a card with no state row yet is
  // still verified before we create one.
  const [card] = await db.select().from(flashcards).where(eq(flashcards.id, cardId)).limit(1);
  if (!card || card.userId !== session.userId) return;

  const [existing] = await db.select().from(cardSrsState)
    .where(eq(cardSrsState.cardId, cardId)).limit(1);

  const next = scheduleReview(
    {
      stability: existing?.stability ?? null,
      difficulty: existing?.difficulty ?? null,
      reps: existing?.reps ?? 0,
      lapses: existing?.lapses ?? 0,
      state: (existing?.state as SrsState) ?? "new",
    },
    RATING_FOR_GRADE[grade],
  );

  const values = {
    stability: next.stability,
    difficulty: next.difficulty,
    dueAt: next.dueAt,
    reps: next.reps,
    lapses: next.lapses,
    state: next.state,
    lastReviewedAt: new Date(),
  };

  if (existing) {
    await db.update(cardSrsState).set(values).where(eq(cardSrsState.id, existing.id));
  } else {
    // A deck whose cards predate the denormalization step has no state row —
    // create it rather than dropping the review on the floor.
    await db.insert(cardSrsState).values({ userId: session.userId, cardId, ...values });
  }
}

/** Loads a deck the caller owns, or throws. Shared by the edit actions below. */
async function requireOwnDeck(deckId: string, userId: string) {
  const row = await requireOwned("artifact", deckId).catch((err) => {
    if (err instanceof AuthzError) throw new Error("deck not found");
    throw err;
  });
  if (row.userId !== userId || row.kind !== "flashcard_deck") throw new Error("deck not found");
  return row;
}

/** Renames a deck. Saved on blur from the title field — there is no save button. */
export async function renameDeckAction(deckId: string, title: string): Promise<void> {
  const session = await requireSession();
  const trimmed = title.trim();
  if (!trimmed) return; // an empty title is a no-op, not a way to erase the name

  await requireOwnDeck(deckId, session.userId);
  await db.update(artifacts)
    .set({ title: trimmed, updatedAt: new Date() })
    .where(eq(artifacts.id, deckId));

  revalidatePath(`/flashcards/${deckId}`);
  revalidatePath("/flashcards");
}

export type CardInput = {
  /** Omitted for a card being added — the server mints the id. */
  id?: string;
  front: string;
  back: string;
  chapter?: string | null;
  section?: string | null;
  week?: number | null;
};

/**
 * Replaces a deck's card set: edits, additions, removals and reordering all
 * arrive as one list, in the order the student arranged them.
 *
 * Ids are PRESERVED for cards that survive the edit, which is what keeps
 * their `card_srs_state` (and so their review history) intact — only cards
 * actually removed lose their scheduling, via the FK cascade. Card order
 * lives in the payload; the denormalized `flashcards` rows are unordered
 * because they exist to answer "what's due", not "what's next".
 */
export async function updateDeckCardsAction(deckId: string, cards: CardInput[]): Promise<void> {
  const session = await requireSession();
  const deck = await requireOwnDeck(deckId, session.userId);

  const existingPayload = flashcardDeckPayloadSchema.safeParse(deck.payload);
  const knownIds = new Set(
    existingPayload.success ? existingPayload.data.cards.map((c) => c.id) : [],
  );

  // Keep an id only if it really belongs to this deck — a client can't graft
  // another deck's card (and its review history) onto this one.
  const next = cards
    .filter((c) => c.front.trim() && c.back.trim())
    .map((c) => ({
      id: c.id && knownIds.has(c.id) ? c.id : randomUUID(),
      front: c.front.trim(),
      back: c.back.trim(),
      chapter: c.chapter ?? null,
      section: c.section ?? null,
      week: c.week ?? null,
    }));

  const payload = flashcardDeckPayloadSchema.parse({ kind: "flashcard_deck", cards: next });

  await db.update(artifacts)
    .set({ payload, version: deck.version + 1, updatedAt: new Date() })
    .where(eq(artifacts.id, deckId));

  const survivingIds = next.map((c) => c.id);
  const currentRows = await db.select({ id: flashcards.id })
    .from(flashcards).where(eq(flashcards.deckId, deckId));
  const currentIds = new Set(currentRows.map((r) => r.id));

  const removed = [...currentIds].filter((id) => !survivingIds.includes(id));
  if (removed.length > 0) {
    // Cascades to card_srs_state — a card the student deleted should not keep
    // coming due.
    await db.delete(flashcards).where(inArray(flashcards.id, removed));
  }

  for (const c of next) {
    if (currentIds.has(c.id)) {
      await db.update(flashcards)
        .set({ front: c.front, back: c.back, chapter: c.chapter, section: c.section, week: c.week })
        .where(eq(flashcards.id, c.id));
    } else {
      await db.insert(flashcards).values({
        id: c.id,
        userId: session.userId,
        deckId,
        courseId: deck.courseId,
        front: c.front,
        back: c.back,
        chapter: c.chapter,
        section: c.section,
        week: c.week,
      });
      await db.insert(cardSrsState).values({ userId: session.userId, cardId: c.id });
    }
  }

  revalidatePath(`/flashcards/${deckId}`);
  revalidatePath("/flashcards");
}
