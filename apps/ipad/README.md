# Mola for iPadOS

A native SwiftUI client for the same Mola backend `apps/web` serves — no
separate mobile API, no bundled content. This app signs in against a running
Mola server and talks to its existing Next.js API routes.

**Status: an unverified scaffold.** This was written in an environment with
no Swift toolchain, Xcode, or iOS simulator available — every file here has
been read through and checked for structural correctness (balanced braces,
exhaustive switches, matching protocol conformances) but **none of it has
been compiled**. Treat first build on a real Mac as the actual code review:
expect a handful of ordinary compiler diagnostics (a wrong argument label, an
inferred type that needs a hint), not a redesign.

## Setting it up

```bash
brew install xcodegen
cd apps/ipad
xcodegen generate
open Mola.xcodeproj
```

`project.yml` is the source of truth (an [XcodeGen](https://github.com/yonaskolb/XcodeGen)
spec); the generated `.xcodeproj` is not committed, the same reasoning as not
committing `.next/` or `node_modules/` — it's a build artifact, and XcodeGen
specs diff far better than Xcode's project file ever does.

Run it in Simulator against a Mola server reachable from your Mac — the
easiest path is the main repo's own `pnpm dev` on `localhost:3000`, which the
app defaults to. On first launch it asks for a server address, then behaves
exactly like opening the web app in a browser: sign in (or sign up) against
that server's real database.

`Info.plist` allows plaintext HTTP to `localhost`/`127.0.0.1` for local dev
(`NSExceptionDomains`). A server reachable over the network — not
`localhost` from the simulator's own host — needs either HTTPS or its own
ATS exception added.

The app icon (`Resources/Assets.xcassets/AppIcon.appiconset`) is an empty
slot — add a 1024×1024 PNG of the mola fish mark the main README describes
before shipping this anywhere. The accent color is already set to the web
app's `--accent` (`#481715`).

## What's wired up

Everything here calls the real backend — no mock data, no fixtures baked
into the app:

- **Auth** — sign in / sign up against Auth.js v5's Credentials provider.
  There's no token endpoint to call (Auth.js's Credentials provider is
  cookie/JWT-session only), so this does what the web `/sign-in` form does:
  fetch a CSRF token, POST the credentials callback, then confirm via
  `/api/auth/session` — all riding on `URLSession`'s shared cookie storage.
- **Chat** — the full agent loop, streamed live over the same SSE contract
  (`packages/shared/src/stream.ts`) the web client reads: text deltas,
  collapsed tool-call rows, sub-agent markers, and artifacts rendering
  inline the moment they're generated.
- **Artifacts** (quizzes, flashcard decks, mind maps) — browsing is real,
  via one new backend endpoint this change adds (see below). Flashcard
  study (flip through a deck) and taking a quiz (graded locally, same rule
  as the server's `gradeQuiz`) both work against the real generated content.
- **Plan** — today/week/semester, reading `GET /api/plan`, accepting a
  pending proposal via `POST /api/plan/:id/accept`, and checking tasks off
  via `PATCH /api/tasks/:id`.
- **Calendar** — a real month grid against `GET /api/calendar/events`.
- **Courses** — name, number, professor, summary, instructions, and that
  course's chats.
- **Settings** — BYOK key save/remove against `/api/settings`.

## One backend change this includes

`apps/web/app/api/artifacts/route.ts` — a new `GET /api/artifacts?kind=`
route. It didn't exist before this: the web app's Quizzes/Flashcards/Artifacts
galleries are Next.js **server components** that query the database directly
(`lib/quizzes/gallery.ts`, `lib/flashcards/gallery.ts`,
`lib/artifacts/gallery.ts`), with no JSON endpoint behind them, because
nothing non-browser ever needed one before. The new route is a thin wrapper
around the same `listAllArtifacts` read those pages already use — same
ownership scoping, nothing new added to the trust boundary.

## What's deliberately not wired up

A few features genuinely can't be reached from a native client without more
backend work than "add a GET route", and a few more were just left for a
follow-up pass. Neither is faked client-side:

- **Quiz attempts and flashcard SRS reviews aren't persisted.** Grading is a
  pure, client-side calculation (matches `lib/quizzes/grading.ts` exactly),
  but `submitQuizAttemptAction` and `recordLearnGradeAction` are Next.js
  **Server Actions** — a protocol a native client can't call without
  reverse-engineering Next's internal `Next-Action` wire format. A real fix
  is a small `POST /api/quizzes/:id/attempts` / `POST /api/flashcards/:id/review`
  pair wrapping the same two functions, mirroring how `/api/artifacts` wraps
  `listAllArtifacts` — not done here to keep this change to one additive
  route.
- **Mind maps render as an indented outline, not a pannable canvas.** The
  web version is a d3 force/zoom layout (`MindMapView.tsx`); reproducing
  that interaction model in SwiftUI (`Canvas`, force simulation, pinch/pan)
  is a project of its own. The outline shows the same tree and the same
  cross-link edges, just not spatially.
- **Course documents, memory, and schedule items aren't shown.** Like the
  galleries, `app/(shell)/courses/[id]/page.tsx` reads those straight from
  the database server-side with no JSON route behind them. Course name,
  summary, instructions, and chats — which `/api/courses` and `/api/chat`
  already expose — are shown; upload, memory editing, and the schedule
  panel are not.
- **Plan amendments aren't wired.** Accepting a proposed plan is;
  `POST /api/plan/:id/amend`'s body shape is more involved and editing a
  plan in place didn't fit this pass.
- **Google Calendar connect and ICS feed management aren't wired.** Google's
  flow is a browser OAuth redirect designed for a web tab, not a sheet — it
  needs a proper `ASWebAuthenticationSession` implementation and a redirect
  URI that round-trips back into the app, which needs a real device to get
  right. The calendar read itself (`GET /api/calendar/events`) already
  reflects whatever's connected on the web side.
- **No offline support, no push notifications, no background refresh.**
  Every screen is a live fetch; backgrounding mid-stream drops the
  connection rather than reconnecting via
  `GET /api/chat/:chatId/messages/:messageId/stream` (that reconnect route
  exists server-side and is modeled in `MolaClient.streamGet`, just not
  called from anywhere yet).

## Architecture

```
Sources/Mola/
  App/            Theme.swift — design tokens ported from apps/web/app/globals.css
  Networking/     MolaClient (cookie-session HTTP + SSE), SSEParser
  Models/         Swift mirrors of packages/shared's frozen contracts
  Features/
    Auth/         Sign in / sign up
    Root/         NavigationSplitView shell, sidebar
    Chat/         Transcript, streaming turn, composer
    Artifacts/    Gallery + flashcard/quiz/mindmap study views
    Courses/      Course detail
    Plan/         Today/week/semester
    Calendar/     Month grid
    Settings/     Server address, account, BYOK key
```

No ViewModel/networking code is shared with the web app or generated from
its types — `Models/` is a hand-maintained Swift mirror of
`packages/shared/src/*.ts`. If a contract there changes, this needs a
matching edit; there's no build step connecting the two today.

### Why cookies, not a token

Auth.js v5 in JWT mode issues its session as an httpOnly cookie, not a
bearer token your app can store and attach itself. Rather than add a
parallel token-auth path to the backend (a real scope change to a system
documented as frozen in several places), `MolaClient` leans on
`URLSession`'s shared cookie storage and behaves like a cookie-based web
client. It works, but it means this app and a browser signed into the same
server share a session store on whatever device runs them — expected
behavior for a cookie session, worth knowing going in.
