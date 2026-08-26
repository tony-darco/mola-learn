/**
 * DEV ONLY sign-in picker.
 *
 * There are no passwords. `lib/auth/session.ts` is a shim that trusts a cookie
 * so Phase 0 could be exercised before Auth.js exists. Agent D deletes this
 * directory and `app/api/dev-login/` when real credentials land.
 */
import { notFound } from "next/navigation";
import { db, users } from "@mola/db";
import { SignInButtons } from "./buttons";

export const dynamic = "force-dynamic";

export default async function DevSignIn() {
  if (process.env.NODE_ENV === "production") notFound();

  const all = await db.select({ id: users.id, email: users.email, name: users.name }).from(users);

  return (
    <main style={{ maxWidth: 560, margin: "80px auto", padding: "0 24px" }}>
      <h1 style={{ marginBottom: 4 }}>Mola — dev sign-in</h1>
      <p style={{ color: "var(--muted)", marginTop: 0 }}>
        No passwords exist yet. Real authentication is Agent D&rsquo;s Phase&nbsp;1 workstream;
        this page just sets a session cookie so you can click around.
      </p>

      {all.length === 0 ? (
        <p style={{ color: "var(--accent)" }}>
          No users in the database. Run <code>pnpm db:seed</code> first.
        </p>
      ) : (
        <SignInButtons users={all} />
      )}

      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 32 }}>
        Sign in as each of them in turn to see the §9 ownership check: Bob gets a 404
        on Alice&rsquo;s chat, not a peek at it.
      </p>
    </main>
  );
}
