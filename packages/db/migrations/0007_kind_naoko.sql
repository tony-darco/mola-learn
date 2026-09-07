CREATE TYPE "public"."textbook_toc_status" AS ENUM('not_applicable', 'pending', 'no_toc_found', 'building', 'ready');--> statement-breakpoint
CREATE TYPE "public"."textbook_unit_status" AS ENUM('pending', 'filling', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "textbook_chapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"chapter_number" integer,
	"title" text NOT NULL,
	"toc_locator" text,
	"start_locator" text,
	"end_locator" text,
	"topics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"markdown" text,
	"status" textbook_unit_status DEFAULT 'pending' NOT NULL,
	"status_detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "textbook_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"chapter_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"title" text NOT NULL,
	"start_locator" text,
	"end_locator" text,
	"markdown" text,
	"status" textbook_unit_status DEFAULT 'ready' NOT NULL,
	"status_detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "textbook_toc_status" textbook_toc_status DEFAULT 'not_applicable' NOT NULL;--> statement-breakpoint
ALTER TABLE "textbook_chapters" ADD CONSTRAINT "textbook_chapters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "textbook_chapters" ADD CONSTRAINT "textbook_chapters_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "textbook_sections" ADD CONSTRAINT "textbook_sections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "textbook_sections" ADD CONSTRAINT "textbook_sections_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "textbook_sections" ADD CONSTRAINT "textbook_sections_chapter_id_textbook_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."textbook_chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "textbook_chapters_doc_ordinal_idx" ON "textbook_chapters" USING btree ("document_id","ordinal");--> statement-breakpoint
CREATE INDEX "textbook_chapters_user_idx" ON "textbook_chapters" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "textbook_chapters_doc_status_idx" ON "textbook_chapters" USING btree ("document_id","status");--> statement-breakpoint
CREATE INDEX "textbook_chapters_fts_idx" ON "textbook_chapters" USING gin (to_tsvector('english', "markdown"));--> statement-breakpoint
CREATE INDEX "textbook_chapters_trgm_idx" ON "textbook_chapters" USING gin ("markdown" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "textbook_sections_chapter_ordinal_idx" ON "textbook_sections" USING btree ("chapter_id","ordinal");--> statement-breakpoint
CREATE INDEX "textbook_sections_user_idx" ON "textbook_sections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "textbook_sections_doc_idx" ON "textbook_sections" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "textbook_sections_chapter_idx" ON "textbook_sections" USING btree ("chapter_id");--> statement-breakpoint
CREATE INDEX "textbook_sections_fts_idx" ON "textbook_sections" USING gin (to_tsvector('english', "markdown"));--> statement-breakpoint
CREATE INDEX "textbook_sections_trgm_idx" ON "textbook_sections" USING gin ("markdown" gin_trgm_ops);