/**
 * The small pieces the two Google OAuth routes share.
 *
 * They live here rather than in either route file because a Next.js route
 * module may only export handlers and route config — a helper exported from
 * `route.ts` fails the build.
 */
import { GOOGLE_CALLBACK_PATH, publicOrigin } from "./google";

export const STATE_COOKIE = "mola_gcal_state";
/** Ten minutes is plenty for a consent screen and short enough to be useless later. */
export const STATE_TTL_SECONDS = 600;

/**
 * The registered redirect URI. `publicOrigin()` wins where it is set — behind a
 * proxy `req.url` is the internal address, and Google matches the redirect URI
 * character for character — and the request origin is the fallback that makes
 * `http://localhost:3000` work on a dev box with no public URL configured.
 */
export function callbackUri(req: Request): string {
  return `${publicOrigin() ?? new URL(req.url).origin}${GOOGLE_CALLBACK_PATH}`;
}

/**
 * The state is held in an httpOnly cookie rather than in the session or a
 * table: it only has to survive one round trip, and comparing it on the way
 * back is what stops a forged callback from attaching someone else's Google
 * account to this session.
 */
export function stateCookie(req: Request, value: string, maxAgeSeconds: number): string {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  // Lax, not Strict: the callback arrives as a top-level navigation from
  // accounts.google.com, and Strict would withhold the cookie exactly then.
  return `${STATE_COOKIE}=${value}; Path=/api/calendar/google; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${secure}`;
}

export function readStateCookie(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === STATE_COOKIE) return rest.join("=") || null;
  }
  return null;
}

/**
 * Every outcome of the flow lands back on the calendar carrying a reason, so
 * the panel can say what happened instead of the student staring at an
 * unchanged screen wondering whether it worked.
 */
export function backToCalendar(req: Request, outcome: string): Response {
  const target = new URL("/calendar", publicOrigin() ?? new URL(req.url).origin);
  target.searchParams.set("google", outcome);
  return new Response(null, {
    status: 302,
    headers: { location: target.toString(), "set-cookie": stateCookie(req, "", 0) },
  });
}
