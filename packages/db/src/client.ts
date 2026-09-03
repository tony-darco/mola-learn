import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import * as authSchema from "./auth-schema";

export const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://mola:mola@localhost:5433/mola";

// Next.js dev-mode hot reload re-evaluates this module on every file change,
// which would otherwise open a fresh batch of Postgres connections each time
// without closing the old ones — a shared remote Postgres runs out of
// connections fast under normal dev-loop iteration. Caching the client on
// `globalThis` (cleared only on a real process restart, not HMR) makes
// reloads reuse the same connection pool instead of leaking a new one.
const globalForDb = globalThis as unknown as { __molaPgClient?: ReturnType<typeof postgres> };

const client = globalForDb.__molaPgClient ?? postgres(DATABASE_URL, { max: 10 });
if (process.env.NODE_ENV !== "production") globalForDb.__molaPgClient = client;

export const db = drizzle(client, { schema: { ...schema, ...authSchema } });
export type DB = typeof db;
