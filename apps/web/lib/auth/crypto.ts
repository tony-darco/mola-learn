/**
 * Encryption at rest for BYOK provider keys (§9, contract 3).
 *
 * "API keys are never returned to the client after save, and never logged."
 * This module is the only place a plaintext key is ever handled — every other
 * layer touches ciphertext plus the last four characters.
 *
 * AES-256-GCM. `MOLA_ENCRYPTION_KEY` must be a 32-byte key, base64-encoded
 * (`openssl rand -base64 32`). No fallback default in production — a missing
 * key must fail loudly, not silently encrypt with a guessable constant.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type EncryptedSecret = { ciphertext: string; iv: string; authTag: string };

function encryptionKey(): Buffer {
  const raw = process.env.MOLA_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "MOLA_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` " +
        "and add it to apps/web/.env.local before saving any API key.",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("MOLA_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256).");
  }
  return key;
}

export function encryptSecret(plaintext: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(secret: EncryptedSecret): string {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(secret.iv, "base64"));
  decipher.setAuthTag(Buffer.from(secret.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

/** Safe to display in Settings, e.g. "sk-…4f2a" (§9). */
export function lastFourOf(plaintext: string): string {
  return plaintext.slice(-4);
}
