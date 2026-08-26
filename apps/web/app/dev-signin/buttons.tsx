"use client";

import { useState } from "react";

type U = { id: string; email: string; name: string };

export function SignInButtons({ users }: { users: U[] }) {
  const [busy, setBusy] = useState<string | null>(null);

  async function signIn(email: string) {
    setBusy(email);
    await fetch("/api/dev-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    window.location.href = "/";
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 24 }}>
      {users.map((u) => (
        <button
          key={u.id}
          onClick={() => signIn(u.email)}
          disabled={busy !== null}
          style={{
            textAlign: "left", padding: "14px 18px", borderRadius: 10,
            border: "1px solid var(--border)", background: "var(--panel)",
            color: "var(--text)", cursor: "pointer", font: "inherit",
          }}
        >
          <div style={{ fontWeight: 600 }}>{busy === u.email ? "Signing in…" : u.name}</div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>{u.email}</div>
        </button>
      ))}
    </div>
  );
}
