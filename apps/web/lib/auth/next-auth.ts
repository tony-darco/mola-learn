/**
 * Auth.js v5 configuration — replaces the Phase 0 cookie shim (contract 2).
 *
 * Credentials only (email + password), JWT sessions. No `DrizzleAdapter` is
 * wired here — see the note below. `accounts` / `sessions` /
 * `verification_tokens` (packages/db/src/auth-schema.ts) stay in the schema,
 * unused, ready for an OAuth provider later.
 *
 * WHY NO ADAPTER: `@auth/drizzle-adapter`'s default Postgres user table shape
 * requires `emailVerified` and `image` columns (see its `pg.d.ts`). Contract 1
 * authorises Agent D to add exactly one column to `users`
 * (`password_hash`) — adding those two as well would be a second, unauthorised
 * schema change. The adapter is also inert for this flow: `createSession` /
 * `getSessionAndUser` only run under the "database" session strategy, and
 * Auth.js does not support "database" sessions with the Credentials provider
 * at all — it forces JWT. `createUser` / `linkAccount` only run for OAuth
 * sign-in, and there are no OAuth providers configured. Wiring the adapter
 * today would be dead code that also fights the frozen schema; documented
 * here instead of raised as a contract issue because nothing frozen actually
 * blocks it.
 */
import NextAuth, { AuthError, type NextAuthResult } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { eq } from "drizzle-orm";
import { db, users } from "@mola/db";
import { verifyPassword } from "./password";

// The explicit `NextAuthResult` annotation works around a pnpm-specific TS2742
// portability error: with the package hoisted under a hashed `.pnpm/` path,
// the plain inferred return type can't be named in this project's declaration
// output. Purely a type-checker workaround — same object either way.
const result: NextAuthResult = NextAuth({
  session: { strategy: "jwt" },
  trustHost: true,
  pages: { signIn: "/sign-in" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email =
          typeof credentials?.email === "string" ? credentials.email.trim().toLowerCase() : "";
        const password = typeof credentials?.password === "string" ? credentials.password : "";
        if (!email || !password) return null;

        const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
        if (!user?.passwordHash) return null;

        const valid = await verifyPassword(password, user.passwordHash);
        if (!valid) return null;

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.email = user.email;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
        session.user.email = token.email ?? session.user.email;
      }
      return session;
    },
  },
});

export const { handlers, auth, signIn, signOut } = result;
export { AuthError };
