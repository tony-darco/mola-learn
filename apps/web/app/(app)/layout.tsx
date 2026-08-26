import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { signOutAction } from "@/lib/auth/actions";

/** Shared chrome for courses / profile / settings. Chat itself lives at "/". */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  return (
    <div>
      <header
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 24px", borderBottom: "1px solid var(--border)", background: "var(--panel)",
        }}
      >
        <nav style={{ display: "flex", gap: 18, alignItems: "center" }}>
          <a href="/" style={{ fontWeight: 600, color: "var(--text)", textDecoration: "none" }}>Mola</a>
          <a href="/courses" style={{ color: "var(--accent)", fontSize: 14 }}>Courses</a>
          <a href="/profile" style={{ color: "var(--accent)", fontSize: 14 }}>Profile</a>
          <a href="/settings" style={{ color: "var(--accent)", fontSize: 14 }}>Settings</a>
        </nav>
        <div style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 13, color: "var(--muted)" }}>
          {session.email}
          <form action={signOutAction}>
            <button
              type="submit"
              style={{ background: "none", border: "none", padding: 0, color: "var(--accent)", cursor: "pointer", font: "inherit" }}
            >
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main style={{ maxWidth: 960, margin: "0 auto", padding: "32px 24px" }}>{children}</main>
    </div>
  );
}
