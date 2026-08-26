/**
 * Sidebar data source and "new chat" action. Ownership is implicit here —
 * everything is scoped to the signed-in session's own userId, so there is no
 * id to guess and nothing to leak (§9's requireOwned is for loading a single
 * resource BY id; listing/creating your own rows needs only requireSession).
 */
import { desc, eq } from "drizzle-orm";
import { chats, courses, db } from "@mola/db";
import { authzResponse, requireSession } from "@/lib/auth/ownership";

export async function GET() {
  try {
    const session = await requireSession();

    const [userChats, userCourses] = await Promise.all([
      db.select({
        id: chats.id, title: chats.title, courseId: chats.courseId, updatedAt: chats.updatedAt,
      }).from(chats).where(eq(chats.userId, session.userId)).orderBy(desc(chats.updatedAt)),
      db.select({
        id: courses.id, name: courses.name, number: courses.number,
      }).from(courses).where(eq(courses.userId, session.userId)),
    ]);

    return Response.json({ chats: userChats, courses: userCourses });
  } catch (err) {
    return authzResponse(err) ?? Response.json({ error: "internal" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    const body = (await req.json().catch(() => ({}))) as { courseId?: string | null; title?: string };

    // A course-scoped chat must actually belong to the caller — otherwise this
    // would be a write-side ownership hole (§9 applies to writes too).
    if (body.courseId) {
      const [course] = await db.select().from(courses)
        .where(eq(courses.id, body.courseId)).limit(1);
      if (!course || course.userId !== session.userId) {
        return Response.json({ error: "course not found" }, { status: 404 });
      }
    }

    const [chat] = await db.insert(chats).values({
      userId: session.userId,
      courseId: body.courseId ?? null,
      title: body.title?.trim() || "New chat",
    }).returning();

    return Response.json({ id: chat!.id });
  } catch (err) {
    return authzResponse(err) ?? Response.json({ error: "internal" }, { status: 500 });
  }
}
