/**
 * Contract 2 (§9) already has a course-shaped resource fixture from the seed
 * (Alice's CMSC 421) and chat-kind coverage in tests/contracts.test.ts. This
 * file adds the two resource kinds Agent D's workstream introduces or touches
 * most directly — "a signed-in user cannot read another user's course or
 * artifact" — using `requireOwned` exactly as every route does. No route is
 * hand-rolling anything here; this exercises the same frozen function.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { artifacts, courses, db, users } from "@mola/db";
import { AuthzError, requireOwned } from "../lib/auth/ownership";

let alice: { id: string }, bob: { id: string }, course: { id: string };
let artifactId: string;

beforeAll(async () => {
  const [a] = await db.select().from(users).where(eq(users.email, "alice@umbc.edu"));
  const [b] = await db.select().from(users).where(eq(users.email, "bob@umbc.edu"));
  if (!a || !b) throw new Error("run `pnpm db:seed` first");
  alice = a;
  bob = b;

  const [c] = await db.select().from(courses).where(eq(courses.userId, alice.id));
  if (!c) throw new Error("run `pnpm db:seed` first");
  course = c;

  const [artifact] = await db
    .insert(artifacts)
    .values({
      userId: alice.id,
      courseId: course.id,
      kind: "flashcard_deck",
      title: "ownership-test fixture",
      payload: { kind: "flashcard_deck", cards: [] },
    })
    .returning();
  artifactId = artifact!.id;
});

afterAll(async () => {
  await db.delete(artifacts).where(eq(artifacts.id, artifactId));
});

describe("contract 2 — course ownership (§9)", () => {
  it("returns the row for its owner", async () => {
    const row = await requireOwned("course", course.id, { userId: alice.id, email: "a" });
    expect(row.id).toBe(course.id);
  });

  it("denies a different signed-in user with 404, not a peek", async () => {
    await expect(
      requireOwned("course", course.id, { userId: bob.id, email: "b" }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("denies an unauthenticated caller with 401", async () => {
    await expect(requireOwned("course", course.id, null)).rejects.toMatchObject({ status: 401 });
  });
});

describe("contract 2 — artifact ownership (§9)", () => {
  it("returns the row for its owner", async () => {
    const row = await requireOwned("artifact", artifactId, { userId: alice.id, email: "a" });
    expect(row.id).toBe(artifactId);
  });

  it("denies a different signed-in user — foreign and missing are indistinguishable", async () => {
    const denial = async (id: string): Promise<AuthzError> => {
      try {
        await requireOwned("artifact", id, { userId: bob.id, email: "b" });
      } catch (e) {
        if (e instanceof AuthzError) return e;
      }
      throw new Error("expected an AuthzError");
    };
    const foreign = await denial(artifactId);
    const missing = await denial("00000000-0000-0000-0000-000000000000");
    expect(foreign.status).toBe(404);
    expect(foreign.status).toBe(missing.status);
    expect(foreign.message).toBe(missing.message);
  });

  it("denies an unauthenticated caller with 401", async () => {
    await expect(requireOwned("artifact", artifactId, null)).rejects.toMatchObject({ status: 401 });
  });
});
