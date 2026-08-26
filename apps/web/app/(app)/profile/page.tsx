import type { CSSProperties } from "react";
import { desc, eq } from "drizzle-orm";
import { courses, db, terms, users } from "@mola/db";
import { requireSession } from "@/lib/auth/ownership";
import { addTermAction, updateProfileAction } from "@/lib/profile/actions";

export const dynamic = "force-dynamic";

const YEAR_LABEL: Record<string, string> = {
  first: "First year", second: "Second year", third: "Third year",
  fourth: "Fourth year", fifth: "Fifth year",
};

export default async function ProfilePage() {
  const session = await requireSession();
  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  const myTerms = await db.select().from(terms).where(eq(terms.userId, session.userId)).orderBy(desc(terms.createdAt));
  const myCourses = await db.select().from(courses).where(eq(courses.userId, session.userId));

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32, alignItems: "start" }}>
      <div>
        <h1 style={{ marginBottom: 16 }}>Profile</h1>
        <form action={updateProfileAction} style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 380 }}>
          <label style={label}>
            Name
            <input name="name" defaultValue={user?.name ?? ""} required style={input} />
          </label>
          <label style={label}>
            University
            <input name="university" defaultValue={user?.university ?? ""} style={input} />
          </label>
          <label style={label}>
            Year
            <select name="year" defaultValue={user?.year ?? ""} style={input}>
              <option value="">—</option>
              {Object.entries(YEAR_LABEL).map(([value, text]) => (
                <option key={value} value={value}>{text}</option>
              ))}
            </select>
          </label>
          <button type="submit" style={button}>Save</button>
        </form>
      </div>

      <div>
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>Terms</h2>
        <form action={addTermAction} style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <input name="label" placeholder="Fall 2026" required style={{ ...input, flex: 1 }} />
          <button type="submit" style={button}>Add term</button>
        </form>

        {myTerms.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 14 }}>No terms yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {myTerms.map((t) => {
              const inTerm = myCourses.filter((c) => c.termId === t.id);
              return (
                <div key={t.id}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{t.label}</div>
                  {inTerm.length === 0 ? (
                    <div style={{ fontSize: 13, color: "var(--muted)" }}>No courses enrolled.</div>
                  ) : (
                    <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 13 }}>
                      {inTerm.map((c) => (
                        <li key={c.id}>
                          <a href={`/courses/${c.id}`} style={{ color: "var(--accent)" }}>
                            {c.number ? `${c.number} — ` : ""}{c.name}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
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
  padding: "10px 16px", borderRadius: 8, border: "1px solid var(--border)",
  background: "var(--accent)", color: "#fff", cursor: "pointer", font: "inherit", fontWeight: 600,
};
