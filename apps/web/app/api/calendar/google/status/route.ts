/**
 * Whether Google Calendar is usable at all, for the panel to render against.
 *
 * A separate endpoint rather than a field on `GET /api/calendar/sources`
 * because that body is frozen (contract D) and J2 renders it too. The client
 * cannot read `GOOGLE_CLIENT_ID` for itself, and the difference between "not
 * set up on this deployment" and "set up but not connected" is the difference
 * between a pointer to the setup doc and a button worth pressing.
 *
 * Nothing secret crosses this line: a boolean, and the account address the
 * student themselves authorized.
 */
import { authzResponse, requireSession } from "@/lib/auth/ownership";
import { canRegisterWatch, hasGoogleCredential, isGoogleConfigured } from "@/lib/calendar/google";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await requireSession();
    const configured = isGoogleConfigured();
    return Response.json({
      configured,
      connectedAs: configured ? await hasGoogleCredential(session.userId) : null,
      // False on any localhost or http origin: Google only pushes to a verified
      // https address, so sync still runs on the job schedule but not live.
      pushAvailable: canRegisterWatch(),
    });
  } catch (err) {
    return authzResponse(err) ?? Response.json({ error: "internal" }, { status: 500 });
  }
}
