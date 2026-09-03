// Vitest runs as a plain Node process — unlike `next dev`/`next build`, it
// never auto-loads `.env.local`. Without this, DATABASE_URL and friends come
// back empty and tests only work if you type them by hand on the command line
// (the same gap e2e/global-setup.ts already works around this same way).
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const envPath = resolve(fileURLToPath(import.meta.url), "../.env.local");
process.loadEnvFile(envPath);
