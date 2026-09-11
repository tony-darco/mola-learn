/**
 * CONTRACT 1 — the database schema. Single source of truth.
 *
 * Read-only to Phase 1 agents. Every user-owned table carries `user_id`
 * DIRECTLY (not via a join walk) so the §9 ownership check is one predicate.
 */
import { sql } from "drizzle-orm";
import {
  index, integer, jsonb, pgEnum, pgTable, real, text,
  timestamp, uniqueIndex, uuid, vector,
} from "drizzle-orm/pg-core";
import { EMBEDDING } from "@mola/shared";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// ── Identity ─────────────────────────────────────────────────────────────────

/** Deliberately NOT freshman/sophomore/junior/senior (§8). */
export const yearEnum = pgEnum("year", ["first", "second", "third", "fourth", "fifth"]);

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  university: text("university"),
  year: yearEnum("year"),
  /**
   * Credentials-provider auth (Agent D, Phase 1). Nullable — an OAuth-only
   * user (none exist yet) would never set one. Never selected into an API
   * response; only compared server-side in the Auth.js authorize() callback.
   */
  passwordHash: text("password_hash"),
  /** Collected at signup (Tab 1) — month/year granularity, stored as the 1st of that month. */
  expectedGradDate: timestamp("expected_grad_date", { withTimezone: true }),
  phoneNumber: text("phone_number"),
  /** What a newly created chat starts with. Updated whenever the user changes either on any chat. */
  defaultModel: text("default_model").notNull().default("qwen3.6:27b"),
  defaultThinkingEnabled: integer("default_thinking_enabled").notNull().default(1),
  /** What create_quiz falls back to when the student's prompt doesn't say
   * how many questions (§6, Agent G) — editable in Settings. */
  defaultQuizQuestionCount: integer("default_quiz_question_count").notNull().default(10),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Additive, never overwritten — Spring 2025 and Fall 2026 coexist (§8). */
export const terms = pgTable("terms", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  startDate: timestamp("start_date", { withTimezone: true }),
  endDate: timestamp("end_date", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("terms_user_idx").on(t.userId)]);

export const courses = pgTable("courses", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  termId: uuid("term_id").references(() => terms.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  number: text("number"),
  professor: text("professor"),
  /**
   * Generated from the syllabus at creation, editable by the student.
   * THE single source of truth: Layer 1 reads this same row the course detail
   * page displays and the student edits. No second copy, no cache to drift (§8).
   */
  summary: text("summary"),
  /** Per-course override on the global Layer-4 rules — Panel 1 (§8). */
  instructions: text("instructions"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("courses_user_idx").on(t.userId)]);

/** Panel 2 — scoped per course so Orgo struggles don't leak into Linear Algebra (§8). */
export const courseMemory = pgTable("course_memory", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("course_memory_course_idx").on(t.courseId)]);

// ── Conversation ─────────────────────────────────────────────────────────────

export const chats = pgTable("chats", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** Null = a general chat, not scoped to a course (§8). */
  courseId: uuid("course_id").references(() => courses.id, { onDelete: "set null" }),
  title: text("title").notNull().default("New chat"),
  isPinned: integer("is_pinned").notNull().default(0),
  /** Snapshotted from the user's default at creation; overridable per chat (§ model switcher). */
  model: text("model").notNull().default("qwen3.6:27b"),
  thinkingEnabled: integer("thinking_enabled").notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("chats_user_idx").on(t.userId), index("chats_course_idx").on(t.courseId)]);

export const roleEnum = pgEnum("message_role", ["user", "assistant", "system", "tool"]);

/**
 * Turn lifecycle, so a reload can distinguish "still generating" / "failed"
 * from "done" instead of replaying a blank or stale row (resumable-chat-state
 * fix). Defaults to "done" so every pre-existing row — all of which already
 * finished before this column existed — reads correctly with no backfill.
 */
export const messageStatusEnum = pgEnum("message_status", ["streaming", "done", "error"]);

export const messages = pgTable("messages", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  chatId: uuid("chat_id").notNull().references(() => chats.id, { onDelete: "cascade" }),
  role: roleEnum("role").notNull(),
  content: text("content").notNull().default(""),
  toolCalls: jsonb("tool_calls"),
  /** Rung served on this turn, if any. Lets the ladder resume across reloads (§3). */
  hintRung: text("hint_rung"),
  status: messageStatusEnum("status").notNull().default("done"),
  /** Set only when status is "error" — the message shown in the failure banner. */
  errorMessage: text("error_message"),
  createdAt: createdAt(),
}, (t) => [
  index("messages_chat_idx").on(t.chatId, t.createdAt),
  // Backs the chat-search agent's grep + BM25 tools (§6). No vector column here —
  // chat recall is a lookup problem, deliberately lexical-only.
  index("messages_fts_idx").using("gin", sql`to_tsvector('english', ${t.content})`),
  index("messages_trgm_idx").using("gin", sql`${t.content} gin_trgm_ops`),
]);

/**
 * Compaction (§4): older turns collapse into a summary at a boundary. The raw
 * transcript underneath is NEVER deleted — the chat-search agent searches both
 * layers and a summary hit points back into the raw turns it condensed.
 */
export const compactionBoundaries = pgTable("compaction_boundaries", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  chatId: uuid("chat_id").notNull().references(() => chats.id, { onDelete: "cascade" }),
  upToMessageId: uuid("up_to_message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  summary: text("summary").notNull(),
  createdAt: createdAt(),
}, (t) => [
  index("compaction_chat_idx").on(t.chatId),
  index("compaction_fts_idx").using("gin", sql`to_tsvector('english', ${t.summary})`),
]);

// ── Documents ────────────────────────────────────────────────────────────────

export const documentKindEnum = pgEnum("document_kind", [
  "syllabus", "textbook", "lecture_transcript", "student_notes",
]);

/** Pointer status walk (§7). The retrieval agent reads this and degrades gracefully. */
export const documentStatusEnum = pgEnum("document_status", [
  "scanning", "extracting", "indexing", "ready", "failed", "quarantined",
]);

/**
 * Textbook chapter-tree progress, independent of documents.status (a textbook
 * is already "ready" via the base chunk/embed pipeline regardless of how far
 * the chapter-tree pass has gotten). "not_applicable" is the default so every
 * non-textbook document, and every .txt textbook (chapter-tree only runs on
 * PDFs), never needs this column touched at all. "no_toc_found" is not an
 * error — a textbook whose TOC heuristic can't find a confident match still
 * finishes ingestion normally, it just never gets a chapter tree.
 */
export const textbookTocStatusEnum = pgEnum("textbook_toc_status", [
  "not_applicable", "pending", "no_toc_found", "building", "ready",
]);

export const documents = pgTable("documents", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").references(() => courses.id, { onDelete: "cascade" }),
  kind: documentKindEnum("kind").notNull(),
  title: text("title").notNull(),
  /** User never writes to SAFE; only the scanner moves objects between buckets (§12). */
  s3KeyRaw: text("s3_key_raw").notNull(),
  s3KeySafe: text("s3_key_safe"),
  status: documentStatusEnum("status").notNull().default("scanning"),
  statusDetail: text("status_detail"),
  /**
   * SKILL.md-styled pointer injected into Layer 3 — title, topic summary,
   * foreword-style summary, embedding status. Never the full content (§7).
   */
  pointerMd: text("pointer_md"),
  /**
   * Content hash. Many students in one pilot upload the same textbook: hash,
   * embed once, and every later upload of that file is instant and free.
   * Only possible because embeddings are platform-owned (contract 3).
   */
  contentSha256: text("content_sha256"),
  byteSize: integer("byte_size"),
  mimeType: text("mime_type"),
  /** Chapter-tree pass progress for textbook kind — see textbookTocStatusEnum. */
  textbookTocStatus: textbookTocStatusEnum("textbook_toc_status").notNull().default("not_applicable"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("documents_user_idx").on(t.userId),
  index("documents_course_idx").on(t.courseId),
  index("documents_sha_idx").on(t.contentSha256),
]);

/**
 * Extracted text lives HERE, not S3 — S3 cannot be searched in place (§12).
 * grep and BM25 both run against this table.
 *
 * `embedding` is the model's NATIVE width, stored untruncated. Nullable, because
 * a chunk exists and is grep/BM25-searchable from the moment it is extracted —
 * embedding lands later, asynchronously (§7).
 *
 * `embedding_model` / `embedding_version` identify which rows a future backfill
 * would need to touch, so a model change stays a targeted migration rather than
 * re-embed-everything-and-hope.
 */
export const documentChunks = pgTable("document_chunks", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  ordinal: integer("ordinal").notNull(),
  text: text("text").notNull(),
  /** Free-form locator carried onto artifact SourceRefs: "ch.3", "§2.1". */
  locator: text("locator"),
  embedding: vector("embedding", { dimensions: EMBEDDING.dim }),
  embeddingModel: text("embedding_model"),
  embeddingVersion: integer("embedding_version"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("chunks_doc_ordinal_idx").on(t.documentId, t.ordinal),
  index("chunks_user_idx").on(t.userId),
  index("chunks_fts_idx").using("gin", sql`to_tsvector('english', ${t.text})`),
  index("chunks_trgm_idx").using("gin", sql`${t.text} gin_trgm_ops`),
  // Cosine, matching the model's already-L2-normalised output. HNSW over IVFFlat:
  // no training step, and it does not degrade as the corpus grows during a semester.
  index("chunks_embedding_idx")
    .using("hnsw", t.embedding.op("vector_cosine_ops")),
]);

// ── Textbook knowledge tree ──────────────────────────────────────────────────
//
// Additive extension of Contract 1: a textbook's own chapter/subsection
// structure, stored as markdown so mind maps/quizzes/flashcards/chat can grep
// and BM25 search it directly instead of always going through document_chunks
// or pgvector. Populated by a separate, eager pass after base ingestion
// completes (apps/ingest/ingest/chapters.py) — never required for a document
// to reach documents.status = "ready".

export const textbookUnitStatusEnum = pgEnum("textbook_unit_status", [
  "pending", "filling", "ready", "failed",
]);

/**
 * One row per chapter detected in a textbook's table of contents. Indexed
 * identically to document_chunks (GIN trigram + GIN tsvector on `markdown`)
 * so the same grep/BM25 query shape works against either table.
 */
export const textbookChapters = pgTable("textbook_chapters", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  ordinal: integer("ordinal").notNull(),
  chapterNumber: integer("chapter_number"),
  title: text("title").notNull(),
  /** Page locator where this chapter's own TOC line was found, e.g. "p.3" — for debugging/citation, not content. */
  tocLocator: text("toc_locator"),
  /** Page locators bounding this chapter's content. endLocator is the next chapter's startLocator, or null (unresolved / last chapter). */
  startLocator: text("start_locator"),
  endLocator: text("end_locator"),
  topics: jsonb("topics").notNull().default(sql`'[]'::jsonb`),
  markdown: text("markdown"),
  status: textbookUnitStatusEnum("status").notNull().default("pending"),
  statusDetail: text("status_detail"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("textbook_chapters_doc_ordinal_idx").on(t.documentId, t.ordinal),
  index("textbook_chapters_user_idx").on(t.userId),
  index("textbook_chapters_doc_status_idx").on(t.documentId, t.status),
  index("textbook_chapters_fts_idx").using("gin", sql`to_tsvector('english', ${t.markdown})`),
  index("textbook_chapters_trgm_idx").using("gin", sql`${t.markdown} gin_trgm_ops`),
]);

/**
 * Subsections within a chapter. Boundaries are model-proposed by scanning the
 * chapter's own text (not dependent on the book's TOC having subsection-level
 * entries) — see apps/ingest/ingest/chapters.py. Status defaults to "ready"
 * because a section row is only ever inserted already filled in, in the same
 * job that fills its parent chapter.
 */
export const textbookSections = pgTable("textbook_sections", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  chapterId: uuid("chapter_id").notNull().references(() => textbookChapters.id, { onDelete: "cascade" }),
  ordinal: integer("ordinal").notNull(),
  title: text("title").notNull(),
  startLocator: text("start_locator"),
  endLocator: text("end_locator"),
  markdown: text("markdown"),
  status: textbookUnitStatusEnum("status").notNull().default("ready"),
  statusDetail: text("status_detail"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("textbook_sections_chapter_ordinal_idx").on(t.chapterId, t.ordinal),
  index("textbook_sections_user_idx").on(t.userId),
  index("textbook_sections_doc_idx").on(t.documentId),
  index("textbook_sections_chapter_idx").on(t.chapterId),
  index("textbook_sections_fts_idx").using("gin", sql`to_tsvector('english', ${t.markdown})`),
  index("textbook_sections_trgm_idx").using("gin", sql`${t.markdown} gin_trgm_ops`),
]);

// ── Artifacts (mirrors contract 6) ───────────────────────────────────────────

export const artifactKindEnum = pgEnum("artifact_kind", ["flashcard_deck", "quiz", "mind_map"]);

export const artifacts = pgTable("artifacts", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").references(() => courses.id, { onDelete: "cascade" }),
  originChatId: uuid("origin_chat_id").references(() => chats.id, { onDelete: "set null" }),
  kind: artifactKindEnum("kind").notNull(),
  title: text("title").notNull(),
  /** Topic search on the Artifacts page without parsing the payload (§8). */
  topics: jsonb("topics").notNull().default(sql`'[]'::jsonb`),
  sources: jsonb("sources").notNull().default(sql`'[]'::jsonb`),
  payload: jsonb("payload").notNull(),
  version: integer("version").notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("artifacts_user_idx").on(t.userId),
  index("artifacts_course_idx").on(t.courseId),
]);

/** Denormalised out of the deck payload so SRS can query due cards directly. */
export const flashcards = pgTable("flashcards", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  deckId: uuid("deck_id").notNull().references(() => artifacts.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").references(() => courses.id, { onDelete: "cascade" }),
  front: text("front").notNull(),
  back: text("back").notNull(),
  chapter: text("chapter"),
  section: text("section"),
  week: integer("week"),
  createdAt: createdAt(),
}, (t) => [index("flashcards_deck_idx").on(t.deckId), index("flashcards_user_idx").on(t.userId)]);

/** FSRS state. Governs due cards in BOTH artifact and chat-quiz modes (§6). */
export const cardSrsState = pgTable("card_srs_state", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  cardId: uuid("card_id").notNull().references(() => flashcards.id, { onDelete: "cascade" }),
  stability: real("stability"),
  difficulty: real("difficulty"),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull().defaultNow(),
  lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
  reps: integer("reps").notNull().default(0),
  lapses: integer("lapses").notNull().default(0),
  state: text("state").notNull().default("new"),
}, (t) => [
  uniqueIndex("srs_card_idx").on(t.cardId),
  index("srs_due_idx").on(t.userId, t.dueAt),
]);

/**
 * One row per completed (or in-progress) quiz attempt (Agent G). Additive
 * table — nothing else references it, so it carries no risk to the frozen
 * artifacts/flashcards/card_srs_state shapes. `quizId` points at the
 * `artifacts` row (kind='quiz') that defines the questions; `answers` is
 * keyed by question id, not ordinal, so it survives the quiz being edited
 * (a question's id is stable across edits — see updateDeckCardsAction's
 * flashcard analog).
 */
export const quizAttempts = pgTable("quiz_attempts", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  quizId: uuid("quiz_id").notNull().references(() => artifacts.id, { onDelete: "cascade" }),
  score: integer("score").notNull().default(0),
  totalQuestions: integer("total_questions").notNull(),
  /** { [questionId]: selectedIndex } — multiple_choice only; short_answer isn't graded here. */
  answers: jsonb("answers").notNull().default(sql`'{}'::jsonb`),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [
  index("quiz_attempts_user_idx").on(t.userId),
  index("quiz_attempts_quiz_idx").on(t.quizId),
]);

// ── Schedule and planning ────────────────────────────────────────────────────

/** "chat" and "plan" are Agent J additions — an item the tutor recorded from a
 * conversation, or one the planning loop time-boxed. Additive only: existing
 * values keep their meaning and ordinal. */
export const scheduleSourceEnum = pgEnum("schedule_source", ["ics", "google", "student", "chat", "plan"]);
/** "class", "exam", "assignment" and "event" are Agent J additions — a real
 * calendar feed carries spans and sittings, not only point deadlines. */
export const scheduleKindEnum = pgEnum("schedule_kind", [
  "deadline", "recurring_task", "study_session", "class", "exam", "assignment", "event",
]);

export const scheduleItems = pgTable("schedule_items", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").references(() => courses.id, { onDelete: "cascade" }),
  kind: scheduleKindEnum("kind").notNull(),
  source: scheduleSourceEnum("source").notNull(),
  title: text("title").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }),
  /** RFC-5545 recurrence for student-defined repeating tasks (§8). */
  rrule: text("rrule"),
  /** Dedupe key for re-synced feed entries. */
  externalId: text("external_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),

  // ── Agent J additions ──────────────────────────────────────────────────
  /** Which feed produced this row; null for student/chat/plan-authored items. */
  calendarSourceId: uuid("calendar_source_id").references(() => calendarSources.id, { onDelete: "cascade" }),
  /** Span events (a lecture, an exam sitting). A pure deadline leaves these
   * null and carries only `dueAt` — the calendar renders `startAt ?? dueAt`. */
  startAt: timestamp("start_at", { withTimezone: true }),
  endAt: timestamp("end_at", { withTimezone: true }),
  /** 0/1, matching this schema's existing integer-for-boolean convention. */
  allDay: integer("all_day").notNull().default(0),
  location: text("location"),
  description: text("description"),
  /** Homework check-off (§8 planner surface). Null means outstanding. */
  completedAt: timestamp("completed_at", { withTimezone: true }),
  /** LAST-MODIFIED from the feed — lets a re-sync skip untouched rows. */
  externalUpdatedAt: timestamp("external_updated_at", { withTimezone: true }),
}, (t) => [
  index("schedule_user_due_idx").on(t.userId, t.dueAt),
  uniqueIndex("schedule_external_idx").on(t.userId, t.source, t.externalId),
  index("schedule_user_start_idx").on(t.userId, t.startAt),
]);

// ── Calendar sources (Agent J) ───────────────────────────────────────────────

/** Tier 1 is the Blackboard-style ICS feed URL; Tier 2 is Google `events.watch` (§10). */
export const calendarSourceKindEnum = pgEnum("calendar_source_kind", ["ics", "google"]);
/**
 * "expired" is its own state on purpose: a Google watch channel lapses within
 * days and then stops delivering notifications SILENTLY, with no error raised
 * (§10, §15.3). It has to be visible rather than inferred from staleness.
 */
export const calendarSyncStatusEnum = pgEnum("calendar_sync_status", [
  "active", "error", "expired", "disabled",
]);

export const calendarSources = pgTable("calendar_sources", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: calendarSourceKindEnum("kind").notNull(),
  /** Student-facing label, e.g. "Blackboard — Fall 2026". */
  name: text("name").notNull(),
  /** ICS feed URL. Null for Google sources. */
  url: text("url"),
  /** Google calendar id (usually the account email, or a secondary calendar). */
  googleCalendarId: text("google_calendar_id"),
  status: calendarSyncStatusEnum("status").notNull().default("active"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastSyncError: text("last_sync_error"),
  /** Google incremental-sync token; a 410 from Google clears it and forces a full resync. */
  syncToken: text("sync_token"),
  /** Google watch channel — renewal reads `channelExpiresAt` (§10 operational catch). */
  channelId: text("channel_id"),
  channelResourceId: text("channel_resource_id"),
  channelExpiresAt: timestamp("channel_expires_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("calendar_sources_user_idx").on(t.userId),
  index("calendar_sources_renewal_idx").on(t.channelExpiresAt),
]);

/**
 * Google OAuth refresh tokens. Deliberately a SEPARATE table from `api_keys`
 * (contract 3 reserves that one for BYOK chat keys) but the same encryption
 * discipline applies: ciphertext only, never logged, never returned to the
 * client (§9).
 */
export const googleCredentials = pgTable("google_credentials", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  googleAccountEmail: text("google_account_email").notNull(),
  ciphertext: text("ciphertext").notNull(),
  iv: text("iv").notNull(),
  authTag: text("auth_tag").notNull(),
  scope: text("scope").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("google_credentials_user_account_idx").on(t.userId, t.googleAccountEmail)]);

export const planHorizonEnum = pgEnum("plan_horizon", ["day", "week", "semester"]);
/** A proposal PERSISTS if the app isn't opened Sunday, and is shown on next open (§5). */
export const planStatusEnum = pgEnum("plan_status", ["proposed", "approved", "amended", "superseded"]);

export const plans = pgTable("plans", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  horizon: planHorizonEnum("horizon").notNull(),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  status: planStatusEnum("status").notNull().default("proposed"),
  payload: jsonb("payload").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),

  // ── Agent J additions ──────────────────────────────────────────────────
  periodEnd: timestamp("period_end", { withTimezone: true }),
  /** Decomposition link: a day plan's parent is its week, a week's is the semester (§5). */
  parentPlanId: uuid("parent_plan_id"),
  /** Set the moment the student accepts. `status` alone can't distinguish
   * "approved just now" from "approved three weeks ago" for the review step. */
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  supersededByPlanId: uuid("superseded_by_plan_id"),
}, (t) => [
  index("plans_user_period_idx").on(t.userId, t.horizon, t.periodStart),
  index("plans_parent_idx").on(t.parentPlanId),
]);

/**
 * Every edit the student makes to a proposed or approved plan, recorded as an
 * event rather than folded into the payload.
 *
 * This table IS the feedback loop of §5: "at end of week, a review step
 * examines the PATTERN of amendments made and re-proposes adjustments to the
 * semester plan." A payload that is simply overwritten in place cannot answer
 * "what kept slipping this week", so the amendments are kept as their own log.
 */
export const planAmendmentActionEnum = pgEnum("plan_amendment_action", [
  "added", "removed", "rescheduled", "resized", "completed", "skipped", "reordered",
]);

export const planAmendments = pgTable("plan_amendments", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  planId: uuid("plan_id").notNull().references(() => plans.id, { onDelete: "cascade" }),
  /** PlannedItem.id inside the plan payload; null for whole-plan amendments. */
  itemId: text("item_id"),
  action: planAmendmentActionEnum("action").notNull(),
  before: jsonb("before"),
  after: jsonb("after"),
  /** Free text from the student, when they gave one ("lab ran long"). */
  reason: text("reason"),
  createdAt: createdAt(),
}, (t) => [
  index("plan_amendments_plan_idx").on(t.planId),
  index("plan_amendments_user_created_idx").on(t.userId, t.createdAt),
]);

// ── Tasks (Agent J) ──────────────────────────────────────────────────────────

export const taskStatusEnum = pgEnum("task_status", ["todo", "done", "skipped"]);
/** Who put it on the list: the planning loop, the student, or the tutor mid-chat. */
export const taskSourceEnum = pgEnum("task_source", ["plan", "student", "agent"]);

/**
 * The check-off surface. A task is the *actionable* unit ("read §4.2, 30 min");
 * a schedule_item is the *calendar* unit ("Quiz 3, Thursday 2pm"). A task
 * usually points at the schedule item it serves, which is what lets the home
 * page say "your quiz is Thursday — two review sessions left".
 */
export const tasks = pgTable("tasks", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").references(() => courses.id, { onDelete: "cascade" }),
  planId: uuid("plan_id").references(() => plans.id, { onDelete: "set null" }),
  /** PlannedItem.id this was materialised from, so re-proposing doesn't duplicate it. */
  planItemId: text("plan_item_id"),
  scheduleItemId: uuid("schedule_item_id").references(() => scheduleItems.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  notes: text("notes"),
  status: taskStatusEnum("status").notNull().default("todo"),
  source: taskSourceEnum("source").notNull().default("plan"),
  /** The day this task is FOR (a plan slot), distinct from the deadline it serves. */
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
  estimatedMinutes: integer("estimated_minutes"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("tasks_user_scheduled_idx").on(t.userId, t.scheduledFor),
  index("tasks_user_status_idx").on(t.userId, t.status),
  uniqueIndex("tasks_plan_item_idx").on(t.planId, t.planItemId),
]);

// ── Secrets ──────────────────────────────────────────────────────────────────

/**
 * BYOK keys — chat completions only (contract 3). Encrypted at rest, never
 * logged, never returned to the client after save (§9). No plaintext column exists.
 */
export const apiKeys = pgTable("api_keys", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  ciphertext: text("ciphertext").notNull(),
  iv: text("iv").notNull(),
  authTag: text("auth_tag").notNull(),
  /** Safe to show in Settings, e.g. "sk-…4f2a". */
  lastFour: text("last_four").notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("api_keys_user_provider_idx").on(t.userId, t.provider)]);

// ── Job queue ────────────────────────────────────────────────────────────────

export const jobStatusEnum = pgEnum("job_status", ["pending", "running", "done", "failed"]);

/**
 * The ONE trigger for the Python ingest worker in Phase 1 (plan item S5).
 * Phase 3 swaps in real S3 event notifications behind an unchanged worker
 * entrypoint — keep that boundary clean so it stays a wiring change.
 */
export const jobs = pgTable("jobs", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  payload: jsonb("payload").notNull(),
  status: jobStatusEnum("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("jobs_claim_idx").on(t.status, t.runAfter)]);

// Sessions for Auth.js live in packages/db/src/auth-schema.ts (contract 2).
