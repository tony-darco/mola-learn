import type { CSSProperties } from "react";
import { eq } from "drizzle-orm";
import { db, terms } from "@mola/db";
import { requireSession } from "@/lib/auth/ownership";
import { createCourseAction } from "@/lib/courses/actions";

export const dynamic = "force-dynamic";

export default async function NewCoursePage() {
  const session = await requireSession();
  const myTerms = await db.select().from(terms).where(eq(terms.userId, session.userId));

  return (
    <div style={{ maxWidth: 520 }}>
      <h1 style={{ marginBottom: 4 }}>Add a course</h1>
      <p style={{ color: "var(--muted)", marginTop: 0 }}>
        The summary isn&rsquo;t a field you fill in — it&rsquo;s generated from the syllabus
        once it&rsquo;s processed, and you can edit it afterward.
      </p>

      {myTerms.length === 0 ? (
        <p style={{ color: "var(--accent)" }}>
          You need a term first. <a href="/profile" style={{ color: "var(--accent)" }}>Add one on your profile.</a>
        </p>
      ) : (
        <form action={createCourseAction} encType="multipart/form-data" style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 20 }}>
          <label style={label}>
            Course name
            <input name="name" type="text" required placeholder="Operating Systems" style={input} />
          </label>
          <label style={label}>
            Course number
            <input name="number" type="text" placeholder="CMSC 421" style={input} />
          </label>
          <label style={label}>
            Professor
            <input name="professor" type="text" placeholder="Dr. Antero" style={input} />
          </label>
          <label style={label}>
            Term
            <select name="termId" required style={input}>
              {myTerms.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </label>
          <label style={label}>
            Syllabus
            <input name="syllabus" type="file" accept=".pdf,.doc,.docx,.txt" style={input} />
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              Optional here, but without it there&rsquo;s nothing to generate a summary from.
            </span>
          </label>
          <button type="submit" style={button}>Create course</button>
        </form>
      )}
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
  marginTop: 8, padding: "10px 16px", borderRadius: 8, border: "1px solid var(--border)",
  background: "var(--accent)", color: "#fff", cursor: "pointer", font: "inherit", fontWeight: 600,
};
