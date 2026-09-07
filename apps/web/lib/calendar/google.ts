/**
 * Google Calendar — Tier 2 (§10).
 *
 * The whole path is here: OAuth, token refresh against an encrypted refresh
 * token, `events.list` incremental sync, `events.watch` channel registration
 * and teardown. Everything is gated on `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`
 * because only Tony can create the OAuth client — with them unset the whole
 * module is inert and the UI says so rather than offering a button that 500s.
 *
 * Every network call takes an injectable `fetch`. The sync logic is tested
 * against recorded fixtures: a test that needs a human to click through an
 * OAuth consent screen is a test that never runs.
 */
import { and, eq } from "drizzle-orm";
import { db, googleCredentials } from "@mola/db";
import { decryptSecret, encryptSecret } from "@/lib/auth/crypto";
import { parseIcsDate } from "./ics";
import { inferKind, placement } from "./mapping";
import type { FeedEvent } from "./types";

const OAUTH_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_TOKEN = "https://oauth2.googleapis.com/token";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

/** Read-only: this product reads a student's calendar and never writes to it. */
export const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

export const GOOGLE_CALLBACK_PATH = "/api/calendar/google/callback";
export const GOOGLE_WEBHOOK_PATH = "/api/calendar/google/webhook";

// ── Configuration gate ───────────────────────────────────────────────────────

export type GoogleConfig = { clientId: string; clientSecret: string };

export function googleConfig(): GoogleConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function isGoogleConfigured(): boolean {
  return googleConfig() !== null;
}

/**
 * Where Google should send the student back, and where it should push
 * notifications. Google requires the push address be HTTPS on a domain it can
 * verify, so a localhost dev box registers no channel at all — sync still runs
 * on the job schedule, it just is not near-real-time. That is a limitation to
 * state, not one to paper over.
 */
export function publicOrigin(): string | null {
  const raw = process.env.MOLA_PUBLIC_URL ?? process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

export function canRegisterWatch(): boolean {
  const origin = publicOrigin();
  return origin !== null && origin.startsWith("https://");
}

export class GoogleApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "GoogleApiError";
  }
}

/** A 410 on `events.list` means the sync token is too old for a delta (§10). */
export class SyncTokenExpired extends Error {}

// ── OAuth ────────────────────────────────────────────────────────────────────

export function buildAuthorizeUrl(input: { clientId: string; redirectUri: string; state: string }): string {
  const url = new URL(OAUTH_AUTHORIZE);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPE);
  // Without both of these Google returns a refresh token on the first consent
  // only, and never again — a re-authorising student would end up with a
  // credential row that cannot be refreshed.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", input.state);
  return url.toString();
}

export type TokenResponse = {
  accessToken: string;
  refreshToken: string | null;
  expiresInSeconds: number;
  scope: string;
};

export async function exchangeCodeForTokens(input: {
  code: string; redirectUri: string; config: GoogleConfig; fetchImpl?: typeof fetch;
}): Promise<TokenResponse> {
  return postToken({
    fetchImpl: input.fetchImpl ?? fetch,
    body: {
      code: input.code,
      client_id: input.config.clientId,
      client_secret: input.config.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
    },
  });
}

export async function refreshAccessToken(input: {
  refreshToken: string; config: GoogleConfig; fetchImpl?: typeof fetch;
}): Promise<TokenResponse> {
  return postToken({
    fetchImpl: input.fetchImpl ?? fetch,
    body: {
      refresh_token: input.refreshToken,
      client_id: input.config.clientId,
      client_secret: input.config.clientSecret,
      grant_type: "refresh_token",
    },
  });
}

async function postToken(input: {
  fetchImpl: typeof fetch; body: Record<string, string>;
}): Promise<TokenResponse> {
  const res = await input.fetchImpl(OAUTH_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(input.body).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    // The token endpoint's error body is the only useful diagnostic here, and
    // it never contains the secret — only an error code and description.
    const detail = typeof json.error_description === "string" ? json.error_description
      : typeof json.error === "string" ? json.error : res.statusText;
    throw new GoogleApiError(`google token exchange failed: ${detail}`, res.status);
  }
  return {
    accessToken: String(json.access_token ?? ""),
    refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : null,
    expiresInSeconds: Number(json.expires_in ?? 3600),
    scope: String(json.scope ?? GOOGLE_SCOPE),
  };
}

// ── Credential storage ───────────────────────────────────────────────────────

/**
 * Same discipline as `api_keys` (§9): ciphertext only, never logged, never
 * returned to the client. Nothing outside this module reads the plaintext.
 */
export async function saveGoogleCredential(input: {
  userId: string; accountEmail: string; refreshToken: string; scope: string;
}): Promise<void> {
  const secret = encryptSecret(input.refreshToken);
  await db.insert(googleCredentials).values({
    userId: input.userId,
    googleAccountEmail: input.accountEmail,
    ciphertext: secret.ciphertext,
    iv: secret.iv,
    authTag: secret.authTag,
    scope: input.scope,
  }).onConflictDoUpdate({
    target: [googleCredentials.userId, googleCredentials.googleAccountEmail],
    set: { ...secret, scope: input.scope, updatedAt: new Date() },
  });
}

export async function deleteGoogleCredential(userId: string, accountEmail: string): Promise<void> {
  await db.delete(googleCredentials).where(and(
    eq(googleCredentials.userId, userId),
    eq(googleCredentials.googleAccountEmail, accountEmail),
  ));
  ACCESS_TOKENS.delete(`${userId}:${accountEmail}`);
}

export async function hasGoogleCredential(userId: string): Promise<string | null> {
  const rows = await db.select({ email: googleCredentials.googleAccountEmail })
    .from(googleCredentials).where(eq(googleCredentials.userId, userId)).limit(1);
  return rows[0]?.email ?? null;
}

/** Access tokens live an hour; re-minting one per API call would be silly. */
const ACCESS_TOKENS = new Map<string, { token: string; expiresAt: number }>();
const TOKEN_SKEW_MS = 60_000;

export async function getAccessToken(input: {
  userId: string; accountEmail: string; fetchImpl?: typeof fetch;
}): Promise<string> {
  const config = googleConfig();
  if (!config) throw new GoogleApiError("google calendar is not configured", 503);

  const cacheKey = `${input.userId}:${input.accountEmail}`;
  const cached = ACCESS_TOKENS.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + TOKEN_SKEW_MS) return cached.token;

  const rows = await db.select().from(googleCredentials).where(and(
    eq(googleCredentials.userId, input.userId),
    eq(googleCredentials.googleAccountEmail, input.accountEmail),
  )).limit(1);
  const row = rows[0];
  if (!row) throw new GoogleApiError(`no google credential for ${input.accountEmail}`, 401);

  const refreshToken = decryptSecret({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag });
  const token = await refreshAccessToken({ refreshToken, config, fetchImpl: input.fetchImpl });
  ACCESS_TOKENS.set(cacheKey, {
    token: token.accessToken,
    expiresAt: Date.now() + token.expiresInSeconds * 1000,
  });
  return token.accessToken;
}

// ── Calendar API ─────────────────────────────────────────────────────────────

export type GoogleEvent = {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  updated?: string;
  recurrence?: string[];
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
};

async function callApi<T>(input: {
  path: string; accessToken: string; fetchImpl: typeof fetch;
  method?: string; body?: unknown; query?: Record<string, string | undefined>;
}): Promise<T> {
  const url = new URL(`${CALENDAR_API}${input.path}`);
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  const res = await input.fetchImpl(url.toString(), {
    method: input.method ?? "GET",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      ...(input.body ? { "content-type": "application/json" } : {}),
    },
    body: input.body ? JSON.stringify(input.body) : undefined,
  });
  if (res.status === 410) throw new SyncTokenExpired("sync token expired");
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new GoogleApiError(`google ${input.path} returned ${res.status}: ${text.slice(0, 200)}`, res.status);
  }
  return (await res.json()) as T;
}

/** The account's own address, which doubles as the primary calendar's id. */
export async function primaryCalendarId(input: {
  accessToken: string; fetchImpl?: typeof fetch;
}): Promise<string> {
  const cal = await callApi<{ id: string }>({
    path: "/calendars/primary", accessToken: input.accessToken, fetchImpl: input.fetchImpl ?? fetch,
  });
  return cal.id;
}

export type EventsPage = { items?: GoogleEvent[]; nextPageToken?: string; nextSyncToken?: string };

/**
 * Every page of a list or a delta, followed to the end.
 *
 * `full` reports whether the caller is holding the entire calendar, which is
 * what decides whether the reconciler is allowed to delete rows that are not
 * in the payload — an incremental page only carries what changed.
 */
export async function listEvents(input: {
  accessToken: string;
  calendarId: string;
  syncToken?: string | null;
  timeMin?: Date;
  fetchImpl?: typeof fetch;
}): Promise<{ events: GoogleEvent[]; nextSyncToken: string | null; full: boolean }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const incremental = Boolean(input.syncToken);
  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | null = null;

  do {
    const page: EventsPage = await callApi<EventsPage>({
      path: `/calendars/${encodeURIComponent(input.calendarId)}/events`,
      accessToken: input.accessToken,
      fetchImpl,
      query: {
        maxResults: "250",
        // Deleted events only appear in a delta if they are asked for; without
        // this a cancellation never reaches us and the row lives forever.
        showDeleted: "true",
        singleEvents: "true",
        pageToken,
        ...(incremental
          ? { syncToken: input.syncToken ?? undefined }
          : { timeMin: (input.timeMin ?? defaultTimeMin()).toISOString() }),
      },
    });
    events.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
    nextSyncToken = page.nextSyncToken ?? nextSyncToken;
  } while (pageToken);

  return { events, nextSyncToken, full: !incremental };
}

/** A semester's worth of history is plenty; the rest is noise in a study planner. */
function defaultTimeMin(): Date {
  return new Date(Date.now() - 120 * 86_400_000);
}

export type WatchChannel = { channelId: string; resourceId: string; expiresAt: Date };

export async function watchEvents(input: {
  accessToken: string; calendarId: string; channelId: string; address: string; token?: string;
  fetchImpl?: typeof fetch;
}): Promise<WatchChannel> {
  const res = await callApi<{ id: string; resourceId: string; expiration?: string }>({
    path: `/calendars/${encodeURIComponent(input.calendarId)}/events/watch`,
    accessToken: input.accessToken,
    fetchImpl: input.fetchImpl ?? fetch,
    method: "POST",
    body: { id: input.channelId, type: "web_hook", address: input.address, token: input.token },
  });
  return {
    channelId: res.id,
    resourceId: res.resourceId,
    // Google always returns an expiration for a calendar channel, but the field
    // is documented optional; a week is its own documented maximum.
    expiresAt: new Date(Number(res.expiration ?? Date.now() + 7 * 86_400_000)),
  };
}

export async function stopChannel(input: {
  accessToken: string; channelId: string; resourceId: string; fetchImpl?: typeof fetch;
}): Promise<void> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const res = await fetchImpl(`${CALENDAR_API}/channels/stop`, {
    method: "POST",
    headers: { authorization: `Bearer ${input.accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ id: input.channelId, resourceId: input.resourceId }),
  });
  // 404 means it already lapsed, which is the state we were aiming for.
  if (!res.ok && res.status !== 404) {
    throw new GoogleApiError(`channels.stop returned ${res.status}`, res.status);
  }
}

// ── Mapping ──────────────────────────────────────────────────────────────────

/**
 * Google → the same normalised shape ICS produces, so one reconciler serves
 * both tiers. `start.date` gets the identical local-midnight treatment as
 * `DTSTART;VALUE=DATE` — Google's all-day dates carry the same trap, including
 * the exclusive end date.
 */
export function mapGoogleEvent(event: GoogleEvent): FeedEvent {
  const allDay = Boolean(event.start?.date);
  const start = googleInstant(event.start);
  const rawEnd = googleInstant(event.end);
  const end = allDay && rawEnd ? new Date(rawEnd.getTime() - 1) : rawEnd;

  const title = event.summary?.trim() || "(untitled)";
  const description = event.description ?? null;
  const rrule = event.recurrence?.find((r) => r.startsWith("RRULE:"))?.slice("RRULE:".length) ?? null;
  const kind = inferKind(title, description, { hasSpan: end !== null && !allDay, hasRrule: rrule !== null });

  return {
    externalId: event.id,
    title,
    description,
    location: event.location ?? null,
    ...placement(kind, start, end, allDay),
    allDay,
    rrule,
    externalUpdatedAt: event.updated ? new Date(event.updated) : null,
    cancelled: event.status === "cancelled",
  };
}

function googleInstant(slot: GoogleEvent["start"]): Date | null {
  if (!slot) return null;
  if (slot.date) return parseIcsDate(slot.date.replace(/-/g, ""))?.date ?? null;
  if (slot.dateTime) {
    const d = new Date(slot.dateTime);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}
