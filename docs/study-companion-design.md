# Mola — Design Document

*Status: pre-build design consolidation.*

---

## 0. The Name

**Mola.**

Named for **Lady Kofoworola Ademola**, the first Black African woman to earn a degree from the University of Oxford — the tail of her name carried forward into a product about getting students through their own degrees.

The name works on three levels at once:

1. **Ademola / Kofoworola** — the namesake.
2. **The mola fish** (*Mola mola*, the ocean sunfish) — the icon.
3. **Mola** — the traditional textile and folk-art form of the indigenous **Guna** people of Panama and parts of Colombia, built from layered panels of cut cloth in bold, high-contrast color.

**The icon is the mola fish rendered in mola textile style.** Layered, hand-cut shapes rather than a flat vector silhouette. That's a strong identity: it's distinctive, it's not the generic edtech gradient-owl, and the layered-panel construction is a quiet visual echo of the product's own layered context architecture.

*Trademark and domain availability should be checked before this is locked publicly.*

---

## 1. What This Is

A ground-up (not forked) AI study companion for university students, built as a **web application whose UI closely mirrors Claude.ai's chat interface** — sidebar, conversation list, main chat pane, inline artifacts. The familiarity is deliberate: no onboarding friction for a UI students may already know. Divergence from that reference happens over time, not at launch.

Architecturally the product borrows heavily from **Claude Code's internals** (agent loop, skills vs. sub-agents, layered context assembly, compaction) while presenting a consumer chat surface rather than a CLI.

**Launch scope:** UMBC-specific pilot, entered via class code.

---

## 2. Competitive Position

This category is crowded. That is useful information: there is no novelty moat, so the pitch is execution and architecture, not "nobody has done this."

**Funded/commercial:**
- **CuFlow** — RAG over lecture slides/PDFs; grounded flashcards, quizzes, SRS
- **Laxu AI** — PDF/image/audio → flashcards, quizzes, notes, tutor
- **Mindgrasp / Turbolearn** — lecture recording → structured notes (Turbolearn does live transcription)
- **NotesXP** — notes, study podcasts, mind maps, flashcards (iOS only)
- **Jungle** — flashcards/quizzes plus short generated teaching videos (rare capability)
- **Knowt** — Quizlet alternative with AI cards + SRS
- **Taskade** — calendar/task side, SRS automation, Google Calendar integration
- **Google NotebookLM** — the gold standard for source-grounded RAG and audio overviews

**Open source precedent (studied, explicitly *not* forked):**
- **Shiori-v1** — Gemini-powered; Google Classroom sync, SRS flashcards, GPA predictor, syllabus import, Pomodoro, ships an MCP server for Claude Code. Closest existing analog to this spec.
- **NeuroPilot** (CaviraOSS) — Cornell notes, SRS, quizzes, podcast generation, RAG chat.

**The actual gap — three things nobody combines well:**
1. **True Socratic/guided pedagogy** rather than answer-generation. Most tools are answer machines.
2. **Calendar-aware proactive nudging** that *reasons over* the calendar rather than just displaying it.
3. **Multi-source-type RAG** — textbook + lecture transcript + the student's own notes, searched together.

Anthropic's Claude for Education / Learning Mode is pedagogical inspiration, not a competitor to build against — Learning Mode is a prompting behavior, not an app with memory, calendar awareness, or ingestion.

---

## 3. Pedagogical Foundation

This layer is grounded in learning-science research rather than engineering intuition — it's the product's core differentiator, so it shouldn't be improvised.

### Zone of Proximal Development / productive struggle
Neither extreme works. **Over-scaffolding** produces learned helplessness — students wait for help before attempting, stop mid-task without support. **Under-scaffolding** produces disengagement and self-doubt — students check out. The target is productive struggle: support arrives once a student is genuinely stuck, not at the first sign of difficulty.

Notably, research on worked examples found that assistance which **fades in** (start minimal, add support only if needed) outperforms assistance that starts high and fades down.

### The graduated hint ladder (VanLehn-style, ~3–4 rungs)
1. **Pointing hint** — directs attention, contains no content
2. **Teaching hint(s)** — increasingly specific conceptual guidance
3. **Bottom-out hint** — the answer or next step, absolute last resort

**Hints are pulled on demand by the student, not auto-escalated on a timer or attempt count.** Research on hint-button behavior consistently associates rapid skipping to the bottom-out hint with worse learning outcomes.

### Six evidence-based strategies driving tool design
Retrieval practice · spaced practice · interleaving · elaborative interrogation · concrete examples · dual coding.

---

## 4. Core Architecture

The core loop is deliberately simple — a **message array plus a read-think-act cycle**. Everything else is a layer bolted onto that loop.

### Skills vs. sub-agents
- **Skills** are cheap. They inject instructions into the *same* context window. A skill is a reusable instruction set — e.g. what makes a well-formed flashcard, how to handle "make this harder" or "split this into two."
- **Sub-agents** are expensive (~7× tokens) but context-safe. A sub-agent is a fresh conversation starting from a blank context, spawned by a single briefing prompt. It inherits none of the parent's history, runs its own tool-calling loop privately, and returns only a final result. Intermediate retrieval and drafting noise never touches the parent conversation. Each can have its own restricted tool list and system prompt.
- Skill selection is **pure LLM reasoning** over a list of skill names and one-line descriptions. No classifier, no embeddings.

**Decision:** the flashcard skill runs inside a sub-agent every time — including every amendment. Each edit spins up a fresh sub-agent rather than continuing one long context.

### Compaction
Adopted directly from Claude Code, applied per-course and per-session across a semester. Recent turns stay raw and verbatim; older turns collapse at a **compact boundary** into a written summary (state, decisions, key facts). The full raw transcript always remains retrievable underneath — nothing is truly deleted.

---

## 5. The Context Layer System

System context is assembled in five ordered layers. Layers 1–4 are deterministic and always loaded; only layer 5 and retrieval results are judged for relevance.

### Layer 1 — Identity / static context
Student name, current term, major, and a short syllabus-derived summary for each enrolled course (a few sentences, generated once at enrollment when a syllabus is provided). Always stamped in, never filtered — cheap and small, mirroring Claude Code's always-present environment info.

### Layer 2 — Calendar-driven (three horizons)
- **2.1 — Today.** The current day's study plan.
- **2.2 — This week.** Quizzes, planned study sessions, near-term deadlines.
- **2.3 — Semester.** Two-week-out horizon and beyond; exams, major deadlines.

**Planning cadence:**
- A weekly planning agent runs **Sunday**, reads the calendar, proposes the week, and asks for amendments.
- If the app isn't opened Sunday, the proposal **persists** and is presented on next open — whatever day that is — before anything else happens.
- Once approved, the week decomposes into daily plans.
- Each day, on first open, a lightweight propose → amend → accept flow runs. A push notification nudges the student to open the app. The accepted daily plan feeds layer 2.1.

**Feedback loop:** amendments to 2.1/2.2 are **not** silently applied to 2.3. At end of week, a review step examines the *pattern* of amendments made and re-proposes adjustments to the semester plan through the same propose-and-approve gate. The semester plan sets direction; lived reality feeds back up to keep it honest.

### Layer 3 — Available skills, tools, and documents
A lightweight, always-loaded list of **names plus one-line descriptions only** (mirroring Claude Code's `<available_skills>` injection). Covers:
- Tool references: mind-map create/read, textbook read/add, flashcard create/read/list, calendar tools
- A catalog of ingested documents (textbooks, lecture transcripts, student notes) via **pointer files** — title, topic summary, embedding status

Full skill instructions and full document content are pulled in **only on demand**.

### Layer 4 — Conversation style and rules
The product's CLAUDE.md equivalent: the deterministic behavioral rulebook. Socratic-by-default tutoring, implemented as the graduated hint ladder in §3. **Not absolute** — the ladder is the escalation path.

### Layer 5 — Live conversation history
Raw recent turns plus compacted summaries of older sessions, per §4.

---

## 6. Agents and Tools

### Retrieval agent (ReAct-style: reason → act → observe)
One agent handles **all** "answer this using textbook / lecture / notes knowledge" requests. Spun up fresh per question rather than being a flat tool call. Three tools underneath:

1. **Grep-style raw-text search** — async, no embeddings required
2. **BM25 keyword relevance search**
3. **Vector similarity search** — available only once a document's embedding status is `ready`

Status lives in that document's pointer file. The agent **checks status and receives a clear "not indexed" signal**, then falls back to grep/BM25 — it never guesses. Embedding of new documents always runs async on a separate thread and never blocks an active conversation.

### Flashcard skill + sub-agent
Creates and amends decks. Must track metadata: which course, which chapter/section/week, creation date. The product needs a per-course view of card counts broken down by chapter.

**Two interaction modes:**
- **Artifact mode** — student browses and flips the deck at their own pace
- **Chat-driven quiz mode** — the agent surfaces the front of a card, the student *types* an answer, the agent evaluates and reveals

Mode two is the real retrieval-practice enforcement — producing an answer beats passively deciding "yeah, I knew that." **SRS scheduling governs which cards come due in both modes.** Correct answers are a natural hook for elaborative interrogation: a quick "why is that the case?" before moving on.

### Chat search agent (grep + BM25 only)

A second retrieval agent, separate from the document retrieval agent, that searches the student's own **conversation history**. Same ReAct shape, spun up fresh per request, but with only **two** tools:

1. **Grep-style raw-text search** across chat turns
2. **BM25 keyword relevance search**

**No semantic/vector search on this one — deliberately.** Three reasons:

- **Chat recall is literal.** When a student says "what did we work out about eigenvectors last week," they're reaching for words they know appeared. Keyword matching is the right instrument; embedding similarity would surface topically-adjacent conversations that don't contain what they asked for.
- **Chat is high-churn.** Every turn of every conversation across a whole semester would need embedding and re-embedding. That's a continuous indexing cost for a search where lexical matching already works well.
- **It keeps the two agents cleanly distinct.** Document retrieval is a semantic problem (a textbook explains a concept in words the student wouldn't have used). Chat retrieval is a lookup problem. Different problems, different tooling.

**Searches both raw turns and compact summaries.** Because of compaction (§4), older sessions exist as written summaries with the raw transcript preserved underneath. The agent must search both layers — a match in a summary should be able to point back into the raw turns it was condensed from.

**Scope:** searches the student's own chats only. This is a per-user boundary enforced server-side, identical to the ownership check in §9 — a search is a read, and reads get checked.

### Mind-map skill + sub-agent
Same skill-wraps-tool pattern. The tool (create + read) is prebuilt engineering. Tracks the same metadata — which book, PDF, and section it derives from.

### Practice quiz generation
Distinct from flashcards, and justified by the research: self-generated test questions beat passive review.

**Creation flow:**
- Entry point: a "new quiz" option from the new-chat screen
- Renders as an artifact, like flashcards and mind maps
- **Defaults live in Settings** (question count, difficulty, source scope) and form the base generation prompt
- **Per-quiz override form** at creation: number of questions · difficulty · which sources to pull from · a free-text topic/focus box
- Blank fields fall back to defaults. The free-text box **appends to** the base prompt rather than replacing it — a custom ask can't accidentally wipe the baseline instructions.

### Interleaved session composer
Deliberately mixes topics and chapters within a study session rather than blocking on one topic, per interleaving research.

### Elaborative interrogation
"Why" and "how" question generation. Candidate to fold into the layer-4 conversation rules rather than existing as a standalone tool.

### Lecture recording — an application feature, not an agent tool
A plain button. Press record → capture lecture audio → transcribe → generate notes informed by layer-1 course context (syllabus, current chapter) → transcript and notes embedded async → searchable through the same retrieval agent as just another document type. **No agent decides whether or when to record.**

### Student notes ingestion
A separate upload section, distinct from lecture recordings, for the student's own handwritten or typed notes (docx, PDF, markdown, txt). Framed deliberately as encouraging the student to do their own recall and writing rather than having the AI do it for them — this reinforces retrieval practice. Feeds the same pipeline as a third document category.

### MVP+1 — Knowledge graph
A visual representation of relationships across *all* ingested sources: textbooks, lecture transcripts, student notes, flashcards, mind maps. This is the differentiator — no competitor cross-links multiple source types this way.

---

## 7. Document Ingestion Pipeline

Full PDFs are stored on disk/object storage. Each document also gets a **lightweight pointer markdown file** — styled like a SKILL.md — containing title, topic summary, foreword-style summary, and embedding status. The pointer is what gets injected into layer 3; never the full content.

**Pipeline order (fully async, off the interactive path):**

```
upload → scan/verify → extract text → chunk → embed
```

**Pointer status walks:** `scanning → extracting → indexing → ready`

The student sees "processing" and keeps chatting. The retrieval agent reads that status and degrades gracefully to grep/BM25 if a document isn't indexed yet.

**On latency:** extraction adds real time, but only to the ingestion path — nothing interactive waits on it. Extracting once at ingestion is precisely what makes later searches fast; the slow design would be reaching back to object storage on every query.

---

## 8. Product Surface

### Navigation (mirroring Claude.ai's layout)

- **Courses** — the Projects equivalent. Silos knowledge and chat per course. Within a course: its chats, tasks, artifacts, and schedule.
- **Chats** — general, not course-scoped
- **Tasks**
- **Artifacts** — a dedicated page; **filterable by course**, **searchable by topic**. Shows flashcard decks, quizzes, mind maps, notes.
- **Schedule** — the layer-2 calendar views (today / week / semester)
- **Settings**
- **Profile**

### Adding a course

Course creation is a single form. The student supplies only identifying information plus one file:

| Field | Notes |
|---|---|
| Course name | e.g. "Operating Systems" |
| Course number | e.g. CMSC 421 |
| Professor name | Feeds the course instructions panel |
| Term | Selected from the additive term list on the profile |
| Syllabus | File upload; runs the standard ingestion pipeline |

**The course summary is not a field the student fills in.** On creation, the syllabus is ingested and a summary is generated from it, then written to the course record in Postgres. The student can amend that summary if the generation is inaccurate, and the amended text replaces it.

**That row is the single source of truth.** Layer 1 reads the course summary from the same place the course detail page displays it and the same place the student edits it. There is no second copy, no cache to drift, no separate "context version" of the summary. One row, read by everything.

### Course detail page

Clicking a course in the sidebar opens `/courses/{course-name}`, structurally mirroring Claude.ai's project window: a chat composer and the list of chats belonging to that course in the main column, with stacked panels down the right side.

**Panel 1 — Instructions.** Professor name plus any specific instructions the student wants applied for this course. This is the per-course override on the global layer-4 conversation rules: tone, notation conventions, "this professor tests on derivations, not definitions," and so on.

**Panel 2 — Memory.** Per-course memory. Scoped to this course only, so what the model learns about how the student struggles in Organic Chemistry doesn't leak into their Linear Algebra sessions.

**Panel 3 — Context.** The document set: syllabus, textbooks, lecture transcripts, the student's own uploaded notes. Each entry shows its pointer-file status (`scanning → extracting → indexing → ready`), so the student can see what's searchable yet and what isn't.

**Panel 4 — Schedule.** Two kinds of entry in one panel:

1. **Generated reminders** — derived from the calendar integration already in place. Homework and assessment deadlines pulled from the Blackboard ICS feed become reminders without the student configuring anything.
2. **Student-defined recurring tasks** — things the student sets themselves, repeating on their own cadence. "Review this week's cards every Tuesday and Thursday," "read ahead one chapter before Friday's lecture."

The schedule is also surfaced on the side of the page, not buried in a tab — the point of the calendar work is that deadlines are *visible* while studying, not something to go looking for.

### Artifacts render in both places
Inline in chat, exactly as Claude renders artifacts — *and* browsable in the dedicated Artifacts page. Flashcards, quizzes, and mind maps all have real interfaces in the web UI, not just chat representations.

### Profile contents
- Name
- University
- **Year** — first year, second year, third year, fourth year, fifth year (deliberately *not* freshman/sophomore/junior/senior)
- **Terms** — additive, never overwritten. Spring 2025, Fall 2025, Fall 2026 all coexist. Adding a new term does not replace the old one.
- **Courses enrolled, per term**

---

## 9. Auth and Security

The distinction that matters, because conflating these is where holes appear:

- **Authentication** — proving who is signed in
- **Authorization** — whether *this* signed-in user may access *this* resource

The requirement, stated concretely:

- Every chat has a unique ID that appears in the URL, behind the application URL
- On every load, the server checks: does this chat belong to the currently authenticated user?
- Logged out + guessed URL → denied
- Logged in **as a different user** + the same URL → denied
- Sign out, sign back in as the rightful owner → access restored

**The security boundary is the server-side ownership check on every request — not the unguessability of the URL, and never a hidden frontend button.** Unguessable IDs are defense in depth, nothing more. This pattern applies to every resource with a shareable ID: chats, courses, artifacts.

**User-supplied API keys are secrets:** encrypted at rest, never logged, never returned to the client after save.

**A dedicated security/auth review pass is required before launch.**

---

## 10. Calendar and LMS Integration

Phased in three tiers. Blackboard and Google Calendar are **complementary sources**, not replacements for one another.

### Tier 1 — Launch, no approval needed
Blackboard's student-generated **personal ICS calendar feed link**. Read-only, one-way, gives due dates and course events only — no grades, no content. Google Calendar or Apple Calendar can subscribe to it.

Chosen specifically because it requires **no Blackboard admin approval**, which removes a launch blocker.

*Known limitation:* static and prone to staleness. New assignments won't appear until the feed refreshes or the user re-adds it — Google-side subscription refresh can lag up to about a day.

### Tier 2 — Launch or near-launch
**Google Calendar via `events.watch` webhooks** (a Google "watch channel"). Near-real-time push updates, no manual re-uploading.

*Operational catch:* watch channels **expire within days**. A background renewal job must re-register before lapse, or notifications stop silently, with no error surfaced.

### Tier 3 — Future
**Full Blackboard REST API.** Exposes courses, content, assignments, and the full gradebook (grades, due dates, created/modified timestamps, filterable). This is what would let the product reason over *real performance data* — flagging genuinely weak topics rather than self-reported ones.

*Blocker:* requires the school's Blackboard administrator to register the application and issue an application ID. This is **not** self-service like Google OAuth. For UMBC that means going through university IT as a dependency — a future unlock, not a day-one requirement.

---

## 11. Infrastructure

| Decision | Choice | Reasoning |
|---|---|---|
| Cloud | **AWS** | Industry standard, strongest hiring signal. Vercel explicitly ruled out. |
| Production hosting | **Not the homelab** | Other students' coursework data. Homelab remains fine for testing. |
| Orchestration | **ECS + Fargate** at launch | Control plane is **free**; pay only for container runtime. |
| Future orchestration | **EKS / Kubernetes** | Migrate once paying users justify it. |

**Why not EKS on day one:** the EKS control plane is a flat **~$73/month per cluster**, charged whether you have one user or zero, before any compute. Separate dev and prod clusters double it. ECS gives real AWS container experience at zero fixed cost, and the migration path to EKS stays open.

---

## 12. Data Layer

### Object storage — S3, incoming/clean/quarantine pattern

This is the standard industry pattern for untrusted user uploads, and it matters here because students uploading PDFs is a genuine attack surface.

```
user → pre-signed URL → RAW bucket
                          ↓ (S3 event)
                       worker: malware scan
                             + file-type sniffing
                             + policy checks (size, type, quota)
                          ↓
          clean → SAFE bucket        infected → QUARANTINE + audit record
                          ↓
              extract text → chunk → embed
```

Key rules:
- The user **never** uploads to the production bucket — a pre-signed URL grants write access to RAW only
- **File-type sniffing** confirms a file claiming to be a PDF actually is one, catching the renamed-executable trick
- **The scanner is the only component permitted to move objects between buckets**
- **Nothing downstream ever reads from RAW**

AWS-native options for the scan step include GuardDuty Malware Protection for S3, or a Lambda-invoked ClamAV.

### Primary database — Postgres on RDS

Holds users, auth/ownership records, chats, courses, terms, artifact metadata — and **the extracted document text**.

That last point matters: **S3 cannot be searched in place.** It's a filing cabinet, not a search engine. Grep-style scanning and BM25 both run against extracted text in Postgres, not against objects in S3. Reaching back to S3 per query would be the slow, expensive design.

### Vector store — pgvector, in the same Postgres instance

**Decision: one database does everything at launch.** No separate Chroma service in production.

- One thing to run, back up, and secure
- BM25 and vector search live side by side
- Chroma stays a homelab/testing option
- The vector workload can be split out later if scale demands it

**S3 and Chroma are not alternatives to each other** — they do different jobs. Files live in object storage; embeddings live in a vector database.

---

## 13. Model Abstraction and Provider Strategy

**Model-agnostic by design**, consistent with the pattern across other projects: every LLM call goes through an internal abstraction layer. No provider-specific SDK calls scattered through the codebase. Swapping model or provider requires no application changes.

### Phasing

| Phase | Provider | Notes |
|---|---|---|
| Beta / testing | **Ollama**, local | Default model: **Qwen 3.5** — light, fast to iterate against |
| Launch | **BYOK** | User selects provider, supplies their own API key |
| MVP+1 | **Platform-hosted keys** | Contingent on revenue that can fund inference |

**Settings** exposes model and provider selection plus API key management. **Onboarding** prompts for provider choice and key entry immediately after account creation.

**Accepted tradeoff:** BYOK is real onboarding friction. A student who must go create a provider account and paste a key before first use is a student who may not finish onboarding. The hosted tier at MVP+1 is the mitigation, and it is gated on revenue rather than shipped optimistically.

---

## 14. Cost Model

*us-east-1 rates as researched — verify against AWS's published pricing before committing.*

| Component | Cost |
|---|---|
| ECS/Fargate control plane | **$0** — pay only for container runtime |
| EKS control plane *(rejected for launch)* | ~$73/month per cluster, fixed, from day one |
| RDS Postgres | **Free for 12 months** on a new account (750 hrs/month smallest instance + 20 GB storage); ~$23/month single-AZ with 100 GB gp3 thereafter |
| S3 | Negligible at pilot scale |
| LLM inference | **User-borne under BYOK** |

**The honest summary:** "completely free until users show up" is not quite achievable — RDS eventually costs real money, and Fargate bills on runtime. But it's small money rather than a fixed $73+/month floor. Under BYOK, the largest variable cost — inference — sits with the user, which substantially de-risks the economics.

---

## 15. Open Questions and Risks

1. **Hint-ladder friction beyond pull-not-push is undecided.** The core anti-gaming mechanism *is* decided: hints are student-pulled, never auto-escalated on a timer or attempt count. What remains open is whether to add a second layer of friction — requiring a brief written attempt between rungs rather than offering a free "next hint" button. Raised, acknowledged, never formally adopted.
2. **Tier 3 Blackboard access depends on UMBC IT.** Out of your control; treat as a future unlock, not a plan.
3. **Google watch channels expire within days.** The renewal job is easy to forget and fails *silently* — worth an alert if renewal lapses.
4. **BYOK onboarding friction** may suppress pilot adoption. Worth measuring directly during the UMBC pilot.
5. **Security review before launch** is a hard gate, not a nice-to-have.
6. **Evaluation strategy is unspecified.** Industry post-mortems consistently name the same ship-killers for this category: STEM hallucinations, FERPA gaps, and shipping engagement metrics instead of learning-gain metrics. Worth deciding early how you'll measure whether students actually *learn more*, not just use it more.
7. **RDS free tier expires at 12 months** — a real cliff, not a gradual increase.
8. **Trademark/domain check on "Mola"** before the name is locked publicly.

---

## 16. Build Order

**MVP**
Chat UI · courses · profile/terms · auth (with review) · document ingestion + quarantine pipeline · document retrieval agent (three tools) · chat search agent (two tools) · flashcards (both modes + SRS) · quizzes · mind maps · Blackboard ICS + Google Calendar push · weekly/daily planning loop · Socratic layer with hint ladder · Ollama/Qwen 3.5 in dev, BYOK in prod

**MVP+1**
Knowledge graph · platform-hosted inference tier · lecture-recording refinement · interleaved session composer maturity · EKS migration if scale justifies it

**Future**
Full Blackboard REST API + gradebook-informed weakness detection · expansion beyond UMBC
