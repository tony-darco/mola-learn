/**
 * DEV ONLY. Sets the shim session cookie so the thin slice and the §9
 * cross-user denial test can switch identities. Agent D deletes this file
 * when real Auth.js lands.
 */
import { eq } from "drizzle-orm";
import { db, users } from "@mola/db";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "not available" }, { status: 404 });
  }
  const { email } = (await req.json()) as { email?: string };
  if (!email) return Response.json({ error: "email required" }, { status: 400 });

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) return Response.json({ error: "no such user" }, { status: 404 });

  return Response.json(
    { userId: user.id, email: user.email },
    {
      headers: {
        "set-cookie":
          `mola_dev_user=${user.id}; Path=/; HttpOnly; SameSite=Lax, ` +
          `mola_dev_email=${encodeURIComponent(user.email)}; Path=/; HttpOnly; SameSite=Lax`,
      },
    },
  );
}
