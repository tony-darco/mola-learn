/**
 * The session seam. Contract 2 and every route code against this signature —
 * it does not change. The body now calls real Auth.js v5 (`lib/auth/next-auth.ts`)
 * instead of trusting a plain cookie.
 *
 * The import of `./next-auth` is dynamic, not static, deliberately: that module
 * pulls in the `next-auth` package, which internally imports `next/server` in a
 * way that only resolves inside Next.js's own bundler/runtime. `ownership.ts`
 * (contract 2, frozen) imports this file statically, and `ownership.ts` is
 * itself imported by `tests/contracts.test.ts`, which runs under plain Vitest
 * — no Next.js runtime present. A static import here would make loading
 * `ownership.ts` alone fail the Phase 0 test suite before a single assertion
 * runs. Every contract-2 test supplies its `Session` explicitly, so the real
 * `getSession()` body — and therefore this import — never executes in tests;
 * deferring it to call time keeps that true without changing the signature.
 */
export type Session = { userId: string; email: string };

export async function getSession(): Promise<Session | null> {
  const { auth } = await import("./next-auth");
  const session = await auth();
  if (!session?.user?.id || !session.user.email) return null;
  return { userId: session.user.id, email: session.user.email };
}
