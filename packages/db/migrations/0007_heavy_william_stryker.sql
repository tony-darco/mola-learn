CREATE TYPE "public"."calendar_source_kind" AS ENUM('ics', 'google');--> statement-breakpoint
CREATE TYPE "public"."calendar_sync_status" AS ENUM('active', 'error', 'expired', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."plan_amendment_action" AS ENUM('added', 'removed', 'rescheduled', 'resized', 'completed', 'skipped', 'reordered');--> statement-breakpoint
CREATE TYPE "public"."task_source" AS ENUM('plan', 'student', 'agent');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('todo', 'done', 'skipped');--> statement-breakpoint
ALTER TYPE "public"."schedule_kind" ADD VALUE 'class';--> statement-breakpoint
ALTER TYPE "public"."schedule_kind" ADD VALUE 'exam';--> statement-breakpoint
ALTER TYPE "public"."schedule_kind" ADD VALUE 'assignment';--> statement-breakpoint
ALTER TYPE "public"."schedule_kind" ADD VALUE 'event';--> statement-breakpoint
ALTER TYPE "public"."schedule_source" ADD VALUE 'chat';--> statement-breakpoint
ALTER TYPE "public"."schedule_source" ADD VALUE 'plan';--> statement-breakpoint
CREATE TABLE "calendar_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "calendar_source_kind" NOT NULL,
	"name" text NOT NULL,
	"url" text,
	"google_calendar_id" text,
	"status" "calendar_sync_status" DEFAULT 'active' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_sync_error" text,
	"sync_token" text,
	"channel_id" text,
	"channel_resource_id" text,
	"channel_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "google_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"google_account_email" text NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"scope" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_amendments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"item_id" text,
	"action" "plan_amendment_action" NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"course_id" uuid,
	"plan_id" uuid,
	"plan_item_id" text,
	"schedule_item_id" uuid,
	"title" text NOT NULL,
	"notes" text,
	"status" "task_status" DEFAULT 'todo' NOT NULL,
	"source" "task_source" DEFAULT 'plan' NOT NULL,
	"scheduled_for" timestamp with time zone,
	"estimated_minutes" integer,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "period_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "parent_plan_id" uuid;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "superseded_by_plan_id" uuid;--> statement-breakpoint
ALTER TABLE "schedule_items" ADD COLUMN "calendar_source_id" uuid;--> statement-breakpoint
ALTER TABLE "schedule_items" ADD COLUMN "start_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "schedule_items" ADD COLUMN "end_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "schedule_items" ADD COLUMN "all_day" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule_items" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "schedule_items" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "schedule_items" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "schedule_items" ADD COLUMN "external_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calendar_sources" ADD CONSTRAINT "calendar_sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_credentials" ADD CONSTRAINT "google_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_amendments" ADD CONSTRAINT "plan_amendments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_amendments" ADD CONSTRAINT "plan_amendments_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_schedule_item_id_schedule_items_id_fk" FOREIGN KEY ("schedule_item_id") REFERENCES "public"."schedule_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_sources_user_idx" ON "calendar_sources" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "calendar_sources_renewal_idx" ON "calendar_sources" USING btree ("channel_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "google_credentials_user_account_idx" ON "google_credentials" USING btree ("user_id","google_account_email");--> statement-breakpoint
CREATE INDEX "plan_amendments_plan_idx" ON "plan_amendments" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "plan_amendments_user_created_idx" ON "plan_amendments" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "tasks_user_scheduled_idx" ON "tasks" USING btree ("user_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "tasks_user_status_idx" ON "tasks" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_plan_item_idx" ON "tasks" USING btree ("plan_id","plan_item_id");--> statement-breakpoint
ALTER TABLE "schedule_items" ADD CONSTRAINT "schedule_items_calendar_source_id_calendar_sources_id_fk" FOREIGN KEY ("calendar_source_id") REFERENCES "public"."calendar_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plans_parent_idx" ON "plans" USING btree ("parent_plan_id");--> statement-breakpoint
CREATE INDEX "schedule_user_start_idx" ON "schedule_items" USING btree ("user_id","start_at");