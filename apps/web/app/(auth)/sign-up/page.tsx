import type { CSSProperties } from "react";
import { signUpAction } from "@/lib/auth/actions";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main style={{ maxWidth: 420, margin: "80px auto", padding: "0 24px" }}>
      <h1 style={{ marginBottom: 4 }}>Create your account</h1>
      <p style={{ color: "var(--muted)", marginTop: 0 }}>
        Real accounts, real passwords — hashed, never logged.
      </p>

      {error && <p style={{ color: "var(--accent)", fontSize: 14 }}>{error}</p>}

      <form action={signUpAction} style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
        <label style={label}>
          Name
          <input name="name" type="text" required autoComplete="name" style={input} />
        </label>
        <label style={label}>
          Email
          <input name="email" type="email" required autoComplete="email" style={input} />
        </label>
        <label style={label}>
          Password
          <input
            name="password" type="password" required minLength={8}
            autoComplete="new-password" style={input}
          />
        </label>
        <button type="submit" style={button}>Sign up</button>
      </form>

      <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 20 }}>
        Already have an account? <a href="/sign-in" style={{ color: "var(--accent)" }}>Sign in</a>
      </p>
    </main>
  );
}

const label: CSSProperties = {
  display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "var(--muted)",
};
const input: CSSProperties = {
  padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)",
  background: "var(--bg)", color: "var(--text)", font: "inherit",
};
const button: CSSProperties = {
  marginTop: 8, padding: "10px 16px", borderRadius: 8, border: "1px solid var(--border)",
  background: "var(--accent)", color: "#fff", cursor: "pointer", font: "inherit", fontWeight: 600,
};
