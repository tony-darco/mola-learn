/**
 * The session seam. Contract 2 and every route code against this signature —
 * it does not change. The body now calls real Auth.js v5 (`lib/auth/next-auth.ts`)
 * instead of trusting a plain cookie.
 */
import { auth } from "./next-auth";

export type Session = { userId: string; email: string };

export async function getSession(): Promise<Session | null> {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) return null;
  return { userId: session.user.id, email: session.user.email };
}
