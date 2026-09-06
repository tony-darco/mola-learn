/**
 * Ownership scoping for the unified Artifacts page (§9) — mirrors
 * tests/flashcards-gallery.test.ts and tests/quizzes-gallery.test.ts.
 * listAllArtifacts takes an explicit userId (no requireSession() call), so
 * it's testable under plain Vitest.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { artifacts, db, users } from "@mola/db";
import { listAllArtifacts } from "../lib/artifacts/gallery";

let alice: { id: string }, bob: { id: string };
let aliceDeckId: string, aliceQuizId: string, aliceMapId: string, bobDeckId: string;

beforeAll(async () => {
  const [a] = await db.select().from(users).where(eq(users.email, "alice@umbc.edu"));
  const [b] = await db.select().from(users).where(eq(users.email, "bob@umbc.edu"));
  if (!a || !b) throw new Error("run `pnpm db:seed` first");
  alice = a;
  bob = b;

  const [deck] = await db.insert(artifacts).values({
    userId: alice.id, kind: "flashcard_deck", title: "gallery-test alice deck",
    payload: { kind: "flashcard_deck", cards: [] },
  }).returning();
  aliceDeckId = deck!.id;

  const [quiz] = await db.insert(artifacts).values({
    userId: alice.id, kind: "quiz", title: "gallery-test alice quiz",
    payload: { kind: "quiz", difficulty: "standard", questions: [] },
  }).returning();
  aliceQuizId = quiz!.id;

  const [map] = await db.insert(artifacts).values({
    userId: alice.id, kind: "mind_map", title: "gallery-test alice map",
    payload: { kind: "mind_map", rootId: "r", nodes: [{ id: "r", label: "Root", parentId: null, note: null }], edges: [] },
  }).returning();
  aliceMapId = map!.id;

  const [bobDeck] = await db.insert(artifacts).values({
    userId: bob.id, kind: "flashcard_deck", title: "gallery-test bob deck",
    payload: { kind: "flashcard_deck", cards: [] },
  }).returning();
  bobDeckId = bobDeck!.id;
});

afterAll(async () => {
  await db.delete(artifacts).where(eq(artifacts.id, aliceDeckId));
  await db.delete(artifacts).where(eq(artifacts.id, aliceQuizId));
  await db.delete(artifacts).where(eq(artifacts.id, aliceMapId));
  await db.delete(artifacts).where(eq(artifacts.id, bobDeckId));
});

describe("listAllArtifacts — §9 ownership scoping across every kind", () => {
  it("returns every kind belonging to the caller", async () => {
    const items = await listAllArtifacts(alice.id);
    const ids = items.map((a) => a.id);
    expect(ids).toContain(aliceDeckId);
    expect(ids).toContain(aliceQuizId);
    expect(ids).toContain(aliceMapId);
  });

  it("never returns another user's artifacts", async () => {
    const items = await listAllArtifacts(alice.id);
    expect(items.map((a) => a.id)).not.toContain(bobDeckId);
  });

  it("returns an empty list for a user who owns nothing", async () => {
    expect(await listAllArtifacts("00000000-0000-0000-0000-000000000000")).toEqual([]);
  });
});
