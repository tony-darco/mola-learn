import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const url = process.env.DATABASE_URL ?? "postgres://mola:REDACTED@192.168.1.17:5433/mola";
const sql = postgres(url, { max: 1 });
const here = dirname(fileURLToPath(import.meta.url));

await migrate(drizzle(sql), { migrationsFolder: join(here, "..", "migrations") });
console.log("migrations applied");
await sql.end();
