/**
 * §9: "API keys are never returned to the client after save, and never
 * logged." `toPublicApiKey` is the one seam a route is allowed to hand to a
 * client — this asserts it never carries ciphertext/iv/authTag, both as a
 * pure unit check and against a real round trip through the encrypted table.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { apiKeys, db, users } from "@mola/db";
import { deleteApiKey, getPublicApiKey, saveApiKey, toPublicApiKey } from "../lib/auth/api-keys";

describe("toPublicApiKey — the client-facing shape", () => {
  it("carries only provider and lastFour", () => {
    const row = {
      id: "x", userId: "u", provider: "openai", ciphertext: "super-secret-ciphertext",
      iv: "iv-bytes", authTag: "tag-bytes", lastFour: "4f2a", createdAt: new Date(),
    };
    const pub = toPublicApiKey(row);
    expect(pub).toEqual({ provider: "openai", lastFour: "4f2a" });

    const serialized = JSON.stringify(pub);
    expect(serialized).not.toContain("ciphertext");
    expect(serialized).not.toContain("super-secret-ciphertext");
    expect(serialized).not.toContain("iv-bytes");
    expect(serialized).not.toContain("tag-bytes");
  });
});

describe("saveApiKey / getPublicApiKey — real round trip through the encrypted table", () => {
  let alice: { id: string };

  beforeAll(async () => {
    // Provision a throwaway key rather than depending on the developer's
    // .env.local — that file is gitignored, so a test that reads it passes
    // only on the machine that wrote it and fails on every other one.
    // The production code SHOULD throw when this is unset; that is asserted
    // separately, and is why this is set here rather than defaulted in source.
    process.env.MOLA_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

    const [a] = await db.select().from(users).where(eq(users.email, "alice@umbc.edu"));
    if (!a) throw new Error("run `pnpm db:seed` first");
    alice = a;
  });

  afterAll(async () => {
    await deleteApiKey(alice.id);
  });

  it("stores the key encrypted and only ever hands back the last four characters", async () => {
    const plaintext = "sk-test-abcdefghijklmnop4f2a";
    await saveApiKey(alice.id, "openai", plaintext);

    const [row] = await db.select().from(apiKeys).where(eq(apiKeys.userId, alice.id));
    expect(row).toBeTruthy();
    expect(row!.ciphertext).not.toBe(plaintext);
    expect(row!.ciphertext).not.toContain(plaintext);

    const pub = await getPublicApiKey(alice.id);
    expect(pub).toEqual({ provider: "openai", lastFour: "4f2a" });

    const serialized = JSON.stringify(pub);
    expect(serialized).not.toContain(plaintext);
    expect(serialized).not.toContain(row!.ciphertext);
  });

  it("keeps at most one saved key per user — a new provider replaces the old one", async () => {
    await saveApiKey(alice.id, "openai", "sk-old-keyold1");
    await saveApiKey(alice.id, "anthropic", "sk-ant-newkey2");

    const rows = await db.select().from(apiKeys).where(eq(apiKeys.userId, alice.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.provider).toBe("anthropic");
  });

  it("deleteApiKey removes it entirely, reverting to the Ollama default", async () => {
    await saveApiKey(alice.id, "openai", "sk-to-be-deleted");
    await deleteApiKey(alice.id);
    await expect(getPublicApiKey(alice.id)).resolves.toBeNull();
  });
});
