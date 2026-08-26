/**
 * Password hashing for the credentials provider (§9). bcrypt, cost 12 — no
 * native bindings required, which matters because Phase 1 runs across four
 * worktrees on whatever machine each agent has.
 */
import bcrypt from "bcryptjs";

const ROUNDS = 12;

export function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, ROUNDS);
}

export function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}
