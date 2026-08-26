import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import * as authSchema from "./auth-schema";

export const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://mola:mola@localhost:5433/mola";

const client = postgres(DATABASE_URL, { max: 10 });
export const db = drizzle(client, { schema: { ...schema, ...authSchema } });
export type DB = typeof db;
