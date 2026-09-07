/**
 * Step one of the Google consent flow, and the target of the panel's
 * "Reconnect" action.
 *
 * Reconnect and first-connect are deliberately the same URL. When a watch
 * channel has lapsed the usual cause is the credential behind it — access
 * revoked in the student's Google account, or a scope change — and re-consent
 * is the only thing that fixes that. `prompt=consent` (buildAuthorizeUrl) means
 * a second trip through here always mints a fresh refresh token rather than
 * silently reusing the dead one.
 */
import { randomUUID } from "node:crypto";
import { authzResponse, requireSession } from "@/lib/auth/ownership";
import { buildAuthorizeUrl, googleConfig } from "@/lib/calendar/google";
import { STATE_TTL_SECONDS, backToCalendar, callbackUri, stateCookie } from "@/lib/calendar/google-oauth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    await requireSession();

    const config = googleConfig();
    if (!config) return backToCalendar(req, "not-configured");

    const state = randomUUID();
    const url = buildAuthorizeUrl({
      clientId: config.clientId,
      redirectUri: callbackUri(req),
      state,
    });

    return new Response(null, {
      status: 302,
      headers: { location: url, "set-cookie": stateCookie(req, state, STATE_TTL_SECONDS) },
    });
  } catch (err) {
    return authzResponse(err) ?? Response.json({ error: "internal" }, { status: 500 });
  }
}
