/**
 * BYOK key management (§9, contract 3): "API keys are never returned to the
 * client after save, and never logged."
 *
 * `toPublicApiKey` is the one seam every response must go through — it is the
 * only function in this file allowed to touch a row and hand data back to a
 * route. Everything else stays server-side.
 *
 * No "active provider" flag exists on `api_keys` (that table is contract 1,
 * frozen — Agent D is authorised to add only `users.password_hash`). Rather
 * than encode an implicit ordering into an unflagged multi-row table, this
 * module enforces at most one saved key per user: saving a new provider's key
 * deletes any other provider's row first. Settings can then only ever show
 * "no key" or "one key," which is also the honest state `getChatProvider`
 * reads.
 */
import { and, desc, eq, ne } from "drizzle-orm";
import { apiKeys, db } from "@mola/db";
import { encryptSecret, lastFourOf } from "./crypto";

export const SUPPORTED_PROVIDERS = ["openai", "anthropic"] as const;
export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

export type PublicApiKey = { provider: string; lastFour: string };

/** The only function allowed to turn a row into something a client sees. */
export function toPublicApiKey(row: { provider: string; lastFour: string }): PublicApiKey {
  return { provider: row.provider, lastFour: row.lastFour };
}

export async function saveApiKey(userId: string, provider: SupportedProvider, plaintext: string): Promise<void> {
  if (!plaintext.trim()) throw new Error("an API key is required");

  const { ciphertext, iv, authTag } = encryptSecret(plaintext);
  const lastFour = lastFourOf(plaintext);

  await db.delete(apiKeys).where(and(eq(apiKeys.userId, userId), ne(apiKeys.provider, provider)));
  await db
    .insert(apiKeys)
    .values({ userId, provider, ciphertext, iv, authTag, lastFour })
    .onConflictDoUpdate({
      target: [apiKeys.userId, apiKeys.provider],
      set: { ciphertext, iv, authTag, lastFour },
    });
}

export async function getPublicApiKey(userId: string): Promise<PublicApiKey | null> {
  const [row] = await db
    .select({ provider: apiKeys.provider, lastFour: apiKeys.lastFour })
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .orderBy(desc(apiKeys.createdAt))
    .limit(1);
  return row ? toPublicApiKey(row) : null;
}

export async function deleteApiKey(userId: string): Promise<void> {
  await db.delete(apiKeys).where(eq(apiKeys.userId, userId));
}
