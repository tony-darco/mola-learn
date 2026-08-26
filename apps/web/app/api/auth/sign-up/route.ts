/**
 * Registration. The Credentials provider only authenticates — Auth.js has no
 * built-in "create an account" flow, so this is the one hand-written piece.
 */
import { registerUser } from "@/lib/auth/register";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { name?: string; email?: string; password?: string }
    | null;

  const result = await registerUser(body ?? {});
  if (!result.ok) {
    const status = result.error.includes("already exists") ? 409 : 400;
    return Response.json({ error: result.error }, { status });
  }
  return Response.json({ ok: true });
}
