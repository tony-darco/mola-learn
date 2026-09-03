/**
 * One-time DB fixture seed for the e2e suite, run before any spec.
 *
 * `packages/db/src/seed.ts` gives us Alice, Bob, one course, and ONE empty
 * chat — it has no messages at all. Several specs in this suite need real
 * multi-turn content (the flash/flicker test needs two already-populated
 * chats to switch between; the compaction test needs 16+ raw turns and a
 * boundary). Generating that live through the LLM would be slow and flaky,
 * so this inserts it directly, the same way `maybeCompact` and the chat route
 * would have — idempotently, keyed by chat title, so re-running the suite
 * doesn't pile up duplicate fixtures.
 *
 * This does NOT touch `packages/db/src/seed.ts` — that file is shared with
 * every other agent's worktree and isn't e2e-specific.
 *
 * Note: this file runs as a plain Node process, not inside Next.js, so
 * `.env.local` isn't auto-loaded the way it is for `next dev`. We load it
 * explicitly. It also opens its OWN short-lived postgres connection (rather
 * than `@mola/db`'s shared singleton) so it can close it cleanly — Playwright
 * runs `globalSetup` in its own primary process, and leaving a connection
 * pool open there (or worse, calling `process.exit()`) would kill/hang the
 * whole `playwright test` invocation before any spec runs.
 */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and } from "drizzle-orm";
import { chats, compactionBoundaries, messages, users } from "@mola/db/schema";

const envPath = resolve(fileURLToPath(import.meta.url), "../../.env.local");
process.loadEnvFile(envPath);

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const db = drizzle(sql, { schema: { chats, compactionBoundaries, messages, users } });

  try {
    const [alice] = await db.select().from(users).where(eq(users.email, "alice@umbc.edu"));
    if (!alice) {
      throw new Error(
        "alice@umbc.edu not found in mola_e2e — run `DATABASE_URL=<mola_e2e url> pnpm db:seed` first",
      );
    }
    const aliceId = alice.id;

    async function findChatByTitle(title: string) {
      const [row] = await db
        .select()
        .from(chats)
        .where(and(eq(chats.userId, aliceId), eq(chats.title, title)));
      return row ?? null;
    }

    // ── Two populated chats for the flash/flicker test ────────────────────
    const flickerFixtures: { title: string; user: string; assistant: string }[] = [
      {
        title: "E2E Flicker A",
        user: "What is a CPU burst?",
        assistant:
          "A **CPU burst** is the interval during which a process uses the CPU without " +
          "needing I/O. In queueing terms this is often written $T_{cpu}$, and the mean " +
          "burst length is $$\\bar T = \\frac{1}{n}\\sum_{i=1}^n T_i$$ where each $T_i$ " +
          "is one burst's duration.",
      },
      {
        title: "E2E Flicker B",
        user: "What does SJF minimize, and can it starve a process?",
        assistant:
          "**Shortest Job First** minimizes average waiting time among non-preemptive " +
          "schedulers. If job lengths are $b_1, b_2, \\dots, b_n$, scheduling them in " +
          "ascending order minimizes $$\\sum_i w_i,$$ the total waiting time — but a " +
          "steady stream of short jobs can starve a long one indefinitely.",
      },
    ];

    for (const fx of flickerFixtures) {
      const existing = await findChatByTitle(fx.title);
      if (existing) continue;

      const [chat] = await db
        .insert(chats)
        .values({ userId: aliceId, courseId: null, title: fx.title })
        .returning();
      const base = Date.now();
      await db.insert(messages).values([
        {
          userId: aliceId, chatId: chat!.id, role: "user", content: fx.user,
          createdAt: new Date(base),
        },
        {
          userId: aliceId, chatId: chat!.id, role: "assistant", content: fx.assistant,
          createdAt: new Date(base + 1000),
        },
      ]);
      console.log(`[e2e global-setup] seeded "${fx.title}"`);
    }

    // ── A long chat with a compaction boundary, seeded directly ───────────
    // COMPACT_THRESHOLD=16, KEEP_RAW=8 (lib/agent/compaction.ts) — 20 raw
    // turns with a boundary at turn 12 mirrors what maybeCompact would have
    // produced, without paying for a real 20-turn LLM conversation.
    const compactionTitle = "E2E Compaction Demo";
    const existingCompactionChat = await findChatByTitle(compactionTitle);
    if (!existingCompactionChat) {
      const [chat] = await db
        .insert(chats)
        .values({ userId: aliceId, courseId: null, title: compactionTitle })
        .returning();

      const base = Date.now();
      const rows = Array.from({ length: 20 }, (_, i) => ({
        userId: aliceId,
        chatId: chat!.id,
        role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        content: i % 2 === 0 ? `User message ${i / 2 + 1}` : `Assistant reply ${(i - 1) / 2 + 1}`,
        createdAt: new Date(base + i * 1000),
      }));
      const inserted = await db.insert(messages).values(rows).returning();
      const ordered = inserted.slice().sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

      const boundaryMessage = ordered[11]!; // 12th message — leaves 8 raw turns after it
      await db.insert(compactionBoundaries).values({
        userId: aliceId,
        chatId: chat!.id,
        upToMessageId: boundaryMessage.id,
        summary:
          "Earlier in this conversation: the student worked through the first six " +
          "question/answer pairs on process scheduling fundamentals — CPU bursts, " +
          "turnaround time, and the difference between preemptive and non-preemptive " +
          "scheduling.",
      });
      console.log(`[e2e global-setup] seeded "${compactionTitle}" with a compaction boundary`);
    }

    console.log("[e2e global-setup] fixtures ready");
  } finally {
    await sql.end();
  }
}

export default main;
