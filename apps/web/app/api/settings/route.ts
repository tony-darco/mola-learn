/**
 * Backs the settings modal (client-side, opens from any page) — unlike the
 * old /settings page's server actions, these never redirect, since the
 * modal must stay open on whatever page it was triggered from.
 */
import { requireSession, authzResponse } from "@/lib/auth/ownership";
import { deleteApiKey, getPublicApiKey, saveApiKey, SUPPORTED_PROVIDERS, type SupportedProvider } from "@/lib/auth/api-keys";

export async function GET() {
  try {
    const session = await requireSession();
    const current = await getPublicApiKey(session.userId);
    return Response.json({ apiKey: current });
  } catch (err) {
    return authzResponse(err) ?? Response.json({ error: "internal" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    const body = (await req.json().catch(() => ({}))) as { provider?: string; key?: string };
    const provider = body.provider ?? "";

    if (!(SUPPORTED_PROVIDERS as readonly string[]).includes(provider)) {
      return Response.json({ error: "unsupported provider" }, { status: 400 });
    }

    await saveApiKey(session.userId, provider as SupportedProvider, body.key ?? "");
    const current = await getPublicApiKey(session.userId);
    return Response.json({ apiKey: current });
  } catch (err) {
    return authzResponse(err) ?? Response.json({ error: err instanceof Error ? err.message : "internal" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const session = await requireSession();
    await deleteApiKey(session.userId);
    return Response.json({ apiKey: null });
  } catch (err) {
    return authzResponse(err) ?? Response.json({ error: "internal" }, { status: 500 });
  }
}
