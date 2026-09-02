/**
 * Backs the settings modal's Courses section (client-side, opens from any
 * page) — unlike the old /courses and /courses/new pages, this never
 * redirects, since the modal must stay open on whatever page it was
 * triggered from.
 */
import { desc, eq } from "drizzle-orm";
import { courses, db, terms } from "@mola/db";
import { authzResponse, requireSession } from "@/lib/auth/ownership";
import { createCourseAction } from "@/lib/courses/actions";

export async function GET() {
  try {
    const session = await requireSession();
    const myTerms = await db.select().from(terms).where(eq(terms.userId, session.userId)).orderBy(desc(terms.createdAt));
    const myCourses = await db.select().from(courses).where(eq(courses.userId, session.userId));
    return Response.json({ terms: myTerms, courses: myCourses });
  } catch (err) {
    return authzResponse(err) ?? Response.json({ error: "internal" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const course = await createCourseAction(formData);
    return Response.json({ course });
  } catch (err) {
    return authzResponse(err) ?? Response.json({ error: err instanceof Error ? err.message : "internal" }, { status: 500 });
  }
}
