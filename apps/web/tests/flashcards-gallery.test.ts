/**
 * Ownership scoping for the Flashcards gallery page (§9): `listFlashcardDecks`
 * is the query the page runs after `requireSession()`, and it's the only
 * thing standing between "my decks" and "everyone's decks" — there's no
 * per-row `requireOwned` call here since this is a list, not a single-id
 * lookup (same shape as `requireSession` is documented for). Mirrors the
 * fixture setup in ownership-agent-d.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { artifacts, db, users } from "@mola/db";
import { listFlashcardDecks } from "../lib/flashcards/gallery";

let alice: { id: string }, bob: { id: string };
let aliceDeckId: string, bobDeckId: string, aliceQuizId: string;

beforeAll(async () => {
  const [a] = await db.select().from(users).where(eq(users.email, "alice@umbc.edu"));
  const [b] = await db.select().from(users).where(eq(users.email, "bob@umbc.edu"));
  if (!a || !b) throw new Error("run `pnpm db:seed` first");
  alice = a;
  bob = b;

  const [aliceDeck] = await db.insert(artifacts).values({
    userId: alice.id,
    kind: "flashcard_deck",
    title: "gallery-test alice deck",
    payload: { kind: "flashcard_deck", cards: [] },
  }).returning();
  aliceDeckId = aliceDeck!.id;

  const [bobDeck] = await db.insert(artifacts).values({
    userId: bob.id,
    kind: "flashcard_deck",
    title: "gallery-test bob deck",
    payload: { kind: "flashcard_deck", cards: [] },
  }).returning();
  bobDeckId = bobDeck!.id;

  // A non-flashcard artifact of Alice's — must never show up in her deck list.
  const [aliceQuiz] = await db.insert(artifacts).values({
    userId: alice.id,
    kind: "quiz",
    title: "gallery-test alice quiz",
    payload: { kind: "quiz", questions: [], difficulty: "standard" },
  }).returning();
  aliceQuizId = aliceQuiz!.id;
});

afterAll(async () => {
  await db.delete(artifacts).where(eq(artifacts.id, aliceDeckId));
  await db.delete(artifacts).where(eq(artifacts.id, bobDeckId));
  await db.delete(artifacts).where(eq(artifacts.id, aliceQuizId));
});

describe("listFlashcardDecks — §9 ownership scoping", () => {
  it("returns only the caller's own decks", async () => {
    const decks = await listFlashcardDecks(alice.id);
    const ids = decks.map((d) => d.id);
    expect(ids).toContain(aliceDeckId);
    expect(ids).not.toContain(bobDeckId);
  });

  it("never returns another user's decks, even when that user has some", async () => {
    const decks = await listFlashcardDecks(bob.id);
    const ids = decks.map((d) => d.id);
    expect(ids).toContain(bobDeckId);
    expect(ids).not.toContain(aliceDeckId);
  });

  it("excludes non-flashcard_deck artifacts belonging to the same user", async () => {
    const decks = await listFlashcardDecks(alice.id);
    expect(decks.every((d) => d.payload.kind === "flashcard_deck")).toBe(true);
    expect(decks.map((d) => d.id)).not.toContain(aliceQuizId);
  });

  it("returns an empty list for a user who owns nothing", async () => {
    const decks = await listFlashcardDecks("00000000-0000-0000-0000-000000000000");
    expect(decks).toEqual([]);
  });
});
