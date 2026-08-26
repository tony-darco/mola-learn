/**
 * The session seam. Agent D replaces the BODY of `getSession` with real
 * Auth.js v5; every caller — including contract 2 — codes against this
 * signature and does not change.
 */
import { cookies } from "next/headers";

export type Session = { userId: string; email: string };

/**
 * DEV ONLY. Reads a plain cookie so the Phase 0 thin slice and the §9
 * cross-user denial test can run before Auth.js is wired.
 *
 * Hard-fails at module scope in production so it cannot ship by accident —
 * this is a scaffold, not an auth system.
 */
if (process.env.NODE_ENV === "production" && !process.env.MOLA_REAL_AUTH) {
  throw new Error(
    "Dev session shim is active in production. Agent D must replace " +
      "lib/auth/session.ts with Auth.js before any deploy.",
  );
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const userId = jar.get("mola_dev_user")?.value;
  const email = jar.get("mola_dev_email")?.value;
  if (!userId || !email) return null;
  return { userId, email };
}
