/**
 * A canvas the e2e board writers saved for Alice (e2e/canvas-reader-board.spec.ts
 * and the like), read straight from the database by its title — the same way
 * those specs find it. Loads apps/web/.env.local for DATABASE_URL.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import type { CanvasElement } from "@mola/shared";
import { ALICE } from "@/e2e/fixtures";

const envPath = resolve(fileURLToPath(new URL(".", import.meta.url)), "../.env.local");
if (!process.env.DATABASE_URL && existsSync(envPath)) process.loadEnvFile(envPath);

/** The elements of Alice's newest canvas titled `title`, or null if she has none. */
export async function loadSavedCanvas(title: string): Promise<{ id: string; elements: CanvasElement[] } | null> {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const [row] = await sql<{ id: string; payload: { elements: CanvasElement[] } }[]>`
      select id, payload from artifacts
      where kind = 'canvas' and title = ${title}
        and user_id = (select id from users where email = ${ALICE.email})
      order by updated_at desc limit 1`;
    return row ? { id: row.id, elements: row.payload.elements } : null;
  } finally {
    await sql.end();
  }
}
