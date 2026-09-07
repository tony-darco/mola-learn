/**
 * Backs the settings modal's Profile section (client-side, opens from any
 * page) — unlike the old /profile page's server action, this never
 * redirects, since the modal must stay open on whatever page it was
 * triggered from.
 */
import { desc, eq } from "drizzle-orm";
import { courses, db, terms, users } from "@mola/db";
import { authzResponse, requireSession } from "@/lib/auth/ownership";
import { updateProfileAction, updateQuizDefaultsAction } from "@/lib/profile/actions";

export async function GET() {
  try {
    const session = await requireSession();
    const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
    const myTerms = await db.select().from(terms).where(eq(terms.userId, session.userId)).orderBy(desc(terms.createdAt));
    const myCourses = await db.select().from(courses).where(eq(courses.userId, session.userId));
    return Response.json({ user, terms: myTerms, courses: myCourses });
  } catch (err) {
    return authzResponse(err) ?? Response.json({ error: "internal" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      name?: string; university?: string; year?: string; defaultQuizQuestionCount?: number;
    };

    // Two independent forms share this route: the profile fields, and (new)
    // the quiz question-count default. Each POST touches only the one it
    // was sent for, so saving one never clobbers the other with a blank.
    if (body.defaultQuizQuestionCount !== undefined) {
      const fd = new FormData();
      fd.set("defaultQuizQuestionCount", String(body.defaultQuizQuestionCount));
      await updateQuizDefaultsAction(fd);
      return Response.json({ ok: true });
    }

    const fd = new FormData();
    fd.set("name", body.name ?? "");
    fd.set("university", body.university ?? "");
    fd.set("year", body.year ?? "");
    await updateProfileAction(fd);
    return Response.json({ ok: true });
  } catch (err) {
    return authzResponse(err) ?? Response.json({ error: err instanceof Error ? err.message : "internal" }, { status: 500 });
  }
}
