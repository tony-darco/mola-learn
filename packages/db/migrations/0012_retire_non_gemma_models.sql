-- Only Gemma 4 models are offered now (apps/web/lib/llm/models.ts). A user or
-- chat row still naming a retired model (qwen3.6, qwen3.8, rnj-1, …) would be
-- rejected as "unknown model", so move it to the default.
UPDATE "users" SET "default_model" = 'gemma4:26b' WHERE "default_model" NOT IN ('gemma4:26b', 'gemma4:12b');--> statement-breakpoint
UPDATE "chats" SET "model" = 'gemma4:26b' WHERE "model" NOT IN ('gemma4:26b', 'gemma4:12b');
