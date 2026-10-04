CREATE TABLE "canvas_ai_edits" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"canvas_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"element" jsonb NOT NULL,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "canvas_ai_edits" ADD CONSTRAINT "canvas_ai_edits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_ai_edits" ADD CONSTRAINT "canvas_ai_edits_canvas_id_artifacts_id_fk" FOREIGN KEY ("canvas_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_ai_edits" ADD CONSTRAINT "canvas_ai_edits_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "canvas_ai_edits_canvas_idx" ON "canvas_ai_edits" USING btree ("canvas_id");