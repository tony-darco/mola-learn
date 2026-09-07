# Google Calendar setup

Tier 2 of calendar ingestion (§10) reads a student's Google Calendar directly
instead of a static ICS export. It needs an OAuth client, and an OAuth client
can only be created by a human in the Google Cloud Console — which is why the
whole path is built but gated: with `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
unset, the app says Google Calendar is not configured and points here. Nothing
is broken in that state, and Tier 1 (ICS feeds) works without any of this.

Everything below is one-time, takes about ten minutes, and costs nothing.

---

## 1. Project and API

1. Open <https://console.cloud.google.com/> and create a project (or pick an
   existing one). Note the project name; every step below happens inside it.
2. **APIs & Services → Library → Google Calendar API → Enable.**
   Nothing else needs enabling. The app never touches Gmail, Drive or People.

## 2. OAuth consent screen

**APIs & Services → OAuth consent screen.**

- **User type: External.** Internal is only available to Google Workspace
  organizations, and a `umbc.edu` student account is not one you control.
- App name, support email, developer email: whatever you like — the student
  sees the app name on the consent screen.
- **Scopes → Add or remove scopes → Manually add:**

  ```
  https://www.googleapis.com/auth/calendar.readonly
  ```

  That is the only scope this app requests, and it is deliberately read-only:
  Mola reads a student's calendar and never writes to it. Google classes it as
  a *sensitive* scope, which matters in step 5.

- **Test users:** add every Google account that will connect a calendar,
  including your own. While the app is in `Testing`, an account that is not on
  this list cannot get through consent at all.

> **The gotcha that will bite you.** While the consent screen is in `Testing`,
> Google expires issued refresh tokens after **seven days**. The symptom is not
> an error — the watch channel simply stops being renewable and the source
> flips to `status: "expired"` in the feeds panel with a "Reconnect" button.
> That is the app working correctly on a credential Google killed. For anything
> beyond a demo, publish the app (step 5).

## 3. Credentials

**APIs & Services → Credentials → Create credentials → OAuth client ID.**

- **Application type: Web application.**
- **Authorized redirect URIs** — add one per origin you will run on. Google
  matches these character for character, so a trailing slash or `http` where
  you meant `https` is a rejected sign-in:

  ```
  http://localhost:3000/api/calendar/google/callback
  https://<your-domain>/api/calendar/google/callback
  ```

  The path is fixed in code (`GOOGLE_CALLBACK_PATH`, `lib/calendar/google.ts`).
  The origin is `MOLA_PUBLIC_URL` when it is set, and the request's own origin
  otherwise — which is what makes `localhost:3000` work with no extra config.

- **Authorized JavaScript origins** can be left empty. The flow is a top-level
  redirect, not a browser-side token grab.

Copy the client ID and client secret; the secret is only shown in full once.

## 4. Environment

In `apps/web/.env.local`:

```bash
GOOGLE_CLIENT_ID=<client id>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<client secret>

# Only needed for push notifications and for deployments behind a proxy, where
# the request's own origin is an internal address Google cannot match. See §6.
MOLA_PUBLIC_URL=https://<your-domain>
```

`MOLA_ENCRYPTION_KEY` must already be set — the refresh token is stored
AES-256-GCM encrypted under it, the same discipline as BYOK provider keys (§9).
If you have not generated one yet:

```bash
openssl rand -base64 32
```

Restart the app. `GET /api/calendar/google/status` now reports
`configured: true`, and the feeds panel offers **Connect Google Calendar**
instead of the setup pointer.

## 5. Publishing (only if this outlives a demo)

**OAuth consent screen → Publish app.** A sensitive scope on a published app
normally requires Google's verification review, which wants a privacy policy,
a verified domain and a demo video, and takes days to weeks. Until it passes,
users see an "unverified app" interstitial they can click through.

The seven-day refresh-token expiry in step 2 goes away the moment the app
leaves `Testing`, verified or not.

## 6. Push notifications, and why localhost cannot have them

Near-real-time sync uses `events.watch`: Google POSTs to a webhook whenever the
calendar changes. Google will only deliver to an **https address on a domain
you have verified**, so a dev box has no way to hold a channel.

To enable it:

1. Verify the domain in [Search Console](https://search.google.com/search-console).
2. Add it under **APIs & Services → Domain verification** in the same project.
3. Set `MOLA_PUBLIC_URL` to that https origin. The receiver is at
   `/api/calendar/google/webhook` (`GOOGLE_WEBHOOK_PATH`), registered
   automatically on connect and re-registered by the `calendar_renew_watch`
   job.

Without it, `canRegisterWatch()` is false, no channel is registered, and the
panel says so plainly. Calendars still sync on the job schedule — you just find
out about a moved exam on the next sweep rather than the same second.

**A channel that lapses stops delivering silently** — no error, anywhere, ever
(§10, §15.3). That is the single most dangerous failure mode in this
workstream, and it is why renewal runs off the stored `channelExpiresAt`
rather than an assumption about how long channels last, and why a source that
cannot be renewed is flipped to `status: "expired"` and rendered as an
actionable "Reconnect" rather than left to be inferred from a calendar that
quietly stopped changing.

## 7. Checking it works

1. Sign in and open `/calendar`.
2. **Connect Google Calendar** → consent → you land back on `/calendar?google=connected`.
3. The feeds panel lists the account with an event count.

The callback reports failures in the same query parameter rather than dumping a
stack trace at the student:

| `?google=` | What happened |
|---|---|
| `connected` | Credential stored, first sync queued. |
| `not-configured` | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` unset — step 4. |
| `denied` | The student pressed Cancel, or Google refused the request. |
| `state-mismatch` | The anti-forgery cookie did not come back. Usually a stale tab; retry. |
| `no-refresh-token` | Google withheld it because a live grant already exists. Revoke Mola's access at <https://myaccount.google.com/permissions> and connect again. |
| `failed` | Anything else; the server log has the detail. |

Sync itself runs as a job (`calendar_sync_google`). With no worker process
running, opening the app drains what is due; `pnpm --filter @mola/web worker`
runs one continuously.

## What is deliberately not here

- **No live-API tests.** The sync logic is covered against recorded fixtures
  (`apps/web/tests/calendar-ics.test.ts` and the injectable `fetch` on every
  Google call). A test that needs a human to click through a consent screen is
  a test that never runs.
- **Only the primary calendar.** `calendar_sources.googleCalendarId` holds the
  account address, which is both the calendar id and the key the credential is
  stored under. Secondary calendars would need those addressed separately, and
  nothing in the product asks for that yet.
