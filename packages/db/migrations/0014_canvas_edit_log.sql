ALTER TYPE "public"."message_role" ADD VALUE 'event';--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "canvas_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "event" jsonb;