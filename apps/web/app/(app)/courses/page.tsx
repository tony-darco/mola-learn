import { desc, eq } from "drizzle-orm";
import { courses, db, terms } from "@mola/db";
import { requireSession } from "@/lib/auth/ownership";

export const dynamic = "force-dynamic";

export default async function CoursesPage() {
  const session = await requireSession();

  const allTerms = await db.select().from(terms).where(eq(terms.userId, session.userId)).orderBy(desc(terms.createdAt));
  const allCourses = await db.select().from(courses).where(eq(courses.userId, session.userId));

  const byTerm = new Map<string, typeof allCourses>();
  for (const c of allCourses) {
    const key = c.termId ?? "none";
    byTerm.set(key, [...(byTerm.get(key) ?? []), c]);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1 style={{ marginBottom: 4 }}>Courses</h1>
        <a href="/courses/new" style={{
          padding: "8px 16px", borderRadius: 8, background: "var(--accent)",
          color: "#fff", textDecoration: "none", fontWeight: 600, fontSize: 14,
        }}>
          + New course
        </a>
      </div>

      {allTerms.length === 0 && (
        <p style={{ color: "var(--muted)" }}>
          No terms yet. <a href="/profile" style={{ color: "var(--accent)" }}>Add one on your profile</a> before creating a course.
        </p>
      )}

      {allTerms.map((term) => {
        const list = byTerm.get(term.id) ?? [];
        return (
          <section key={term.id} style={{ marginTop: 28 }}>
            <h2 style={{ fontSize: 14, textTransform: "uppercase", color: "var(--muted)", marginBottom: 10 }}>
              {term.label}
            </h2>
            {list.length === 0 ? (
              <p style={{ color: "var(--muted)", fontSize: 14 }}>No courses in this term yet.</p>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {list.map((c) => (
                  <a
                    key={c.id}
                    href={`/courses/${c.id}`}
                    style={{
                      display: "block", padding: "14px 18px", borderRadius: 10,
                      border: "1px solid var(--border)", background: "var(--panel)",
                      color: "var(--text)", textDecoration: "none",
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>
                      {c.number ? `${c.number} — ` : ""}{c.name}
                    </div>
                    {c.professor && <div style={{ fontSize: 13, color: "var(--muted)" }}>{c.professor}</div>}
                  </a>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
