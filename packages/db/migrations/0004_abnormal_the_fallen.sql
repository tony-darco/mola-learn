ALTER TABLE "chats" ADD COLUMN "model" text DEFAULT 'qwen3.6:27b' NOT NULL;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "thinking_enabled" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "default_model" text DEFAULT 'qwen3.6:27b' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "default_thinking_enabled" integer DEFAULT 1 NOT NULL;