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
- **Artifacts** (quizzes, flashcard decks, mind maps, canvases) — browsing is
  real, via one new backend endpoint this change adds (see below). Flashcard
  study (flip through a deck) and taking a quiz (graded locally, same rule
  as the server's `gradeQuiz`) both work against the real generated content.
- **Canvas** — a real freehand whiteboard: pen, eraser, pan/zoom, a basic
  text box, and the canvas's own chat panel (ask Mola about what's on the
  board), all saved to and loaded from the same `artifacts` row the web
  canvas edits. Two new backend routes this change adds make that possible
  (see below) — everything it reads or writes is real data, not a local
  mock. What it does *not* reproduce is the web canvas's full editing
  surface; see "What's deliberately not wired up."
- **Plan** — today/week/semester, reading `GET /api/plan`, accepting a
  pending proposal via `POST /api/plan/:id/accept`, and checking tasks off
  via `PATCH /api/tasks/:id`.
- **Calendar** — a real month grid against `GET /api/calendar/events`.
- **Courses** — name, number, professor, summary, instructions, and that
  course's chats.
- **Settings** — BYOK key save/remove against `/api/settings`.

## Backend changes this includes

Three new, additive routes — nothing existing was modified, and each wraps
logic the web app already trusts rather than re-deriving it:

- **`GET /api/artifacts?kind=`** (`apps/web/app/api/artifacts/route.ts`).
  The web app's Quizzes/Flashcards/Artifacts galleries are Next.js **server
  components** that query the database directly (`lib/quizzes/gallery.ts`,
  `lib/flashcards/gallery.ts`, `lib/artifacts/gallery.ts`), with no JSON
  endpoint behind them, because nothing non-browser ever needed one before.
  This wraps the same `listAllArtifacts` read — same ownership scoping,
  nothing new added to the trust boundary. Canvases are `artifacts` rows
  like any other (`kind: "canvas"`), so this one route already covers them
  too; nothing canvas-specific was needed here.
- **`POST /api/canvas`** (`apps/web/app/api/canvas/route.ts`) — create a
  canvas. The web equivalent, `createCanvasAction`, is a Server Action that
  ends in `redirect(/canvas/:id)`; this mirrors its insert exactly but
  returns `{ id }` as JSON instead.
- **`PATCH /api/canvas/:canvasId`** (`apps/web/app/api/canvas/[canvasId]/route.ts`)
  — save a canvas's elements/viewport/background. Unlike the create route,
  this one **calls the existing `saveCanvasAction` directly** rather than
  re-deriving its logic: that action never redirects, so it's safe to invoke
  from a route handler, and doing so keeps the optimistic-concurrency
  (`version`) compare-and-swap in exactly one place instead of two copies
  that could drift apart.

All three were verified with `pnpm --filter @mola/web typecheck` and a full
`pnpm --filter @mola/web build` — both clean.

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
- **The canvas board has no shape/line/note/math/image creation tools, no
  marquee selection, no undo stack, and no hachure fills.** Only pen, eraser,
  pan/zoom and a plain text box can *create* content — but an element of any
  type made on the web (a shape, a sticky note, a math block, an uploaded
  image, a frame) still **renders** when opened here, just without those
  tools to make another one. Math shows its raw LaTeX source, not a KaTeX
  render — there's no LaTeX engine in SwiftUI. Dots/grid/lines backgrounds
  all draw as the same dot grid (`blank` is the one pattern that's actually
  distinct). The canvas chat always sends the *whole* board as context —
  there's no marquee "ask about just this region" selection yet, though the
  wire format (`lib/canvas/chat.ts`'s `selection.rect`) already supports it.
  A conflicting save (someone else — the web client, say — saved first)
  adopts the server's version number rather than attempting a merge; the
  *next* local edit's save retries cleanly, but the loser's un-saved edit in
  between isn't reconciled against what changed.
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
    Root/         The shell — one main panel plus a sliding drawer (the role
                  Sidebar.tsx plays on the web), shaped like Claude's own
                  iPad app rather than a three-column NavigationSplitView
    Chat/         Transcript, streaming turn, composer, new-chat screen
    Artifacts/    Gallery + flashcard/quiz/mindmap study views
    Canvas/       Board (pen/eraser/pan/zoom/text), its own chat panel
    Courses/      Course detail
    Plan/         Today/week/semester
    Calendar/     Month grid
    Settings/     Server address, account, BYOK key
```

No ViewModel/networking code is shared with the web app or generated from
its types — `Models/` is a hand-maintained Swift mirror of
`packages/shared/src/*.ts` (including the `canvas*` schemas added on
`feat/canvas`). If a contract there changes, this needs a matching edit;
there's no build step connecting the two today.

### Why cookies, not a token

Auth.js v5 in JWT mode issues its session as an httpOnly cookie, not a
bearer token your app can store and attach itself. Rather than add a
parallel token-auth path to the backend (a real scope change to a system
documented as frozen in several places), `MolaClient` leans on
`URLSession`'s shared cookie storage and behaves like a cookie-based web
client. It works, but it means this app and a browser signed into the same
server share a session store on whatever device runs them — expected
behavior for a cookie session, worth knowing going in.
