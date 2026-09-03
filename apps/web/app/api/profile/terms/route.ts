/** Adds a term from the settings modal's Profile section. Never redirects — see the sibling /api/profile route. */
import { desc, eq } from "drizzle-orm";
import { db, terms } from "@mola/db";
import { authzResponse, requireSession } from "@/lib/auth/ownership";
import { addTermAction } from "@/lib/profile/actions";

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    const body = (await req.json().catch(() => ({}))) as { label?: string };
    const fd = new FormData();
    fd.set("label", body.label ?? "");
    await addTermAction(fd);
    const myTerms = await db.select().from(terms).where(eq(terms.userId, session.userId)).orderBy(desc(terms.createdAt));
    return Response.json({ terms: myTerms });
  } catch (err) {
    return authzResponse(err) ?? Response.json({ error: err instanceof Error ? err.message : "internal" }, { status: 500 });
  }
}
