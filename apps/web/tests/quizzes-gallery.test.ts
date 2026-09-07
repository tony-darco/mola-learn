/**
 * Ownership scoping for quizzes (§9) — mirrors tests/flashcards-gallery.test.ts
 * exactly: listQuizzes takes an explicit userId (no requireSession() call),
 * so it's testable under plain Vitest without the Next.js runtime that a
 * server action's own requireSession() needs (see lib/auth/session.ts's
 * docstring on why that call is deferred to a dynamic import, and why every
 * contract-2 test supplies its Session explicitly rather than resolving one).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { artifacts, db, users } from "@mola/db";
import { listQuizzes } from "../lib/quizzes/gallery";

let alice: { id: string }, bob: { id: string };
let aliceQuizId: string, bobQuizId: string, aliceDeckId: string;

beforeAll(async () => {
  const [a] = await db.select().from(users).where(eq(users.email, "alice@umbc.edu"));
  const [b] = await db.select().from(users).where(eq(users.email, "bob@umbc.edu"));
  if (!a || !b) throw new Error("run `pnpm db:seed` first");
  alice = a;
  bob = b;

  const [aliceQuiz] = await db.insert(artifacts).values({
    userId: alice.id, kind: "quiz", title: "gallery-test alice quiz",
    payload: { kind: "quiz", difficulty: "standard", questions: [] },
  }).returning();
  aliceQuizId = aliceQuiz!.id;

  const [bobQuiz] = await db.insert(artifacts).values({
    userId: bob.id, kind: "quiz", title: "gallery-test bob quiz",
    payload: { kind: "quiz", difficulty: "standard", questions: [] },
  }).returning();
  bobQuizId = bobQuiz!.id;

  // A non-quiz artifact of Alice's — must never show up in her quiz list.
  const [aliceDeck] = await db.insert(artifacts).values({
    userId: alice.id, kind: "flashcard_deck", title: "gallery-test alice deck",
    payload: { kind: "flashcard_deck", cards: [] },
  }).returning();
  aliceDeckId = aliceDeck!.id;
});

afterAll(async () => {
  await db.delete(artifacts).where(eq(artifacts.id, aliceQuizId));
  await db.delete(artifacts).where(eq(artifacts.id, bobQuizId));
  await db.delete(artifacts).where(eq(artifacts.id, aliceDeckId));
});

describe("listQuizzes — §9 ownership scoping", () => {
  it("returns only the caller's own quizzes", async () => {
    const quizzes = await listQuizzes(alice.id);
    const ids = quizzes.map((q) => q.id);
    expect(ids).toContain(aliceQuizId);
    expect(ids).not.toContain(bobQuizId);
  });

  it("never returns another user's quizzes, even when that user has some", async () => {
    const quizzes = await listQuizzes(bob.id);
    const ids = quizzes.map((q) => q.id);
    expect(ids).toContain(bobQuizId);
    expect(ids).not.toContain(aliceQuizId);
  });

  it("excludes non-quiz artifacts belonging to the same user", async () => {
    const quizzes = await listQuizzes(alice.id);
    expect(quizzes.every((q) => q.payload.kind === "quiz")).toBe(true);
    expect(quizzes.map((q) => q.id)).not.toContain(aliceDeckId);
  });

  it("returns an empty list for a user who owns nothing", async () => {
    expect(await listQuizzes("00000000-0000-0000-0000-000000000000")).toEqual([]);
  });
});
