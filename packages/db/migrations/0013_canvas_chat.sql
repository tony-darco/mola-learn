ALTER TABLE "chats" ADD COLUMN "canvas_id" uuid;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "canvas_labels" jsonb;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "canvas_context" jsonb;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_canvas_id_artifacts_id_fk" FOREIGN KEY ("canvas_id") REFERENCES "public"."artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chats_canvas_idx" ON "chats" USING btree ("canvas_id");