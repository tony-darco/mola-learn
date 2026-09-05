/**
 * Sidebar data source and "new chat" action. Ownership is implicit here —
 * everything is scoped to the signed-in session's own userId, so there is no
 * id to guess and nothing to leak (§9's requireOwned is for loading a single
 * resource BY id; listing/creating your own rows needs only requireSession).
 */
import { desc, eq } from "drizzle-orm";
import { chats, courses, db, users } from "@mola/db";
import { authzResponse, requireSession } from "@/lib/auth/ownership";
import { CHAT_MODELS, DEFAULT_CHAT_MODEL } from "@/lib/llm";

export async function GET() {
  try {
    const session = await requireSession();

    const [userChats, userCourses] = await Promise.all([
      db.select({
        id: chats.id, title: chats.title, courseId: chats.courseId, updatedAt: chats.updatedAt, isPinned: chats.isPinned,
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
    const body = (await req.json().catch(() => ({}))) as {
      courseId?: string | null;
      title?: string;
      model?: string;
      thinkingEnabled?: boolean;
    };

    // A course-scoped chat must actually belong to the caller — otherwise this
    // would be a write-side ownership hole (§9 applies to writes too).
    if (body.courseId) {
      const [course] = await db.select().from(courses)
        .where(eq(courses.id, body.courseId)).limit(1);
      if (!course || course.userId !== session.userId) {
        return Response.json({ error: "course not found" }, { status: 404 });
      }
    }

    if (body.model !== undefined && !CHAT_MODELS.some((m) => m.id === body.model)) {
      return Response.json({ error: "unknown model" }, { status: 400 });
    }

    const [user] = await db.select({
      defaultModel: users.defaultModel, defaultThinkingEnabled: users.defaultThinkingEnabled,
    }).from(users).where(eq(users.id, session.userId)).limit(1);

    // An explicit pick on the "new chat" composer becomes the default too —
    // same rule as changing it on an existing chat (§ model switcher). Stored
    // raw, not clamped against the model — see the PATCH handler's comment
    // for why (the runtime layer in lib/llm/index.ts is the actual guard).
    //
    // A fallback to the stored default is re-validated against CHAT_MODELS
    // too, not just an explicit body.model — a model retired from CHAT_MODELS
    // after being saved as someone's default must not silently propagate
    // into a new chat row unchecked.
    const model = body.model ?? (CHAT_MODELS.some((m) => m.id === user!.defaultModel) ? user!.defaultModel : DEFAULT_CHAT_MODEL);
    const thinkingEnabled = body.thinkingEnabled ?? user!.defaultThinkingEnabled === 1;

    const chat = await db.transaction(async (tx) => {
      if (body.model !== undefined || body.thinkingEnabled !== undefined) {
        await tx.update(users).set({
          defaultModel: model, defaultThinkingEnabled: thinkingEnabled ? 1 : 0,
        }).where(eq(users.id, session.userId));
      }

      const [row] = await tx.insert(chats).values({
        userId: session.userId,
        courseId: body.courseId ?? null,
        title: body.title?.trim() || "New chat",
        model,
        thinkingEnabled: thinkingEnabled ? 1 : 0,
      }).returning();
      return row!;
    });

    return Response.json({ id: chat.id, model: chat.model, thinkingEnabled: chat.thinkingEnabled === 1 });
  } catch (err) {
    return authzResponse(err) ?? Response.json({ error: "internal" }, { status: 500 });
  }
}
