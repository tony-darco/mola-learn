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
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("chats_user_idx").on(t.userId), index("chats_course_idx").on(t.courseId)]);

export const roleEnum = pgEnum("message_role", ["user", "assistant", "system", "tool"]);

export const messages = pgTable("messages", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  chatId: uuid("chat_id").notNull().references(() => chats.id, { onDelete: "cascade" }),
  role: roleEnum("role").notNull(),
  content: text("content").notNull().default(""),
  toolCalls: jsonb("tool_calls"),
  /** Rung served on this turn, if any. Lets the ladder resume across reloads (§3). */
  hintRung: text("hint_rung"),
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

// ── Schedule and planning ────────────────────────────────────────────────────

export const scheduleSourceEnum = pgEnum("schedule_source", ["ics", "google", "student"]);
export const scheduleKindEnum = pgEnum("schedule_kind", ["deadline", "recurring_task", "study_session"]);

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
}, (t) => [
  index("schedule_user_due_idx").on(t.userId, t.dueAt),
  uniqueIndex("schedule_external_idx").on(t.userId, t.source, t.externalId),
]);

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
}, (t) => [index("plans_user_period_idx").on(t.userId, t.horizon, t.periodStart)]);

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
