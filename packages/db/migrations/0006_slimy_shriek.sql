-- Guarded (IF NOT EXISTS / duplicate_object) rather than drizzle-kit's plain
-- CREATE TYPE / ADD COLUMN: the shared dev Postgres instance already carries
-- this exact column pair from a parallel worktree's migration run, so this
-- must no-op cleanly there while still creating them on a fresh database.
DO $$ BEGIN
 CREATE TYPE "public"."message_status" AS ENUM('streaming', 'done', 'error');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "status" "message_status" DEFAULT 'done' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "error_message" text;
