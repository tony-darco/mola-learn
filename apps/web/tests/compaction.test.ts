/**
 * Compaction (§4): the correctness property under test is that the raw
 * transcript is NEVER deleted — only a summary boundary is added on top of it.
 * Uses an injected fake summarizer so this test never depends on a live
 * Ollama host, unlike the default `llmSummarizer`.
 *
 * Requires the local stack, same as tests/contracts.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { chats, compactionBoundaries, db, messages, users } from "@mola/db";
import { COMPACT_THRESHOLD, KEEP_RAW, maybeCompact } from "../lib/agent/compaction";

let alice: { id: string };
let chatId: string;

const fakeSummarize = async (turns: { role: string; content: string }[]) =>
  `SUMMARY(${turns.length} turns)`;

beforeAll(async () => {
  const [a] = await db.select().from(users).where(eq(users.email, "alice@umbc.edu"));
  if (!a) throw new Error("run `pnpm db:seed` first");
  alice = a;

  const [chat] = await db.insert(chats).values({
    userId: alice.id, courseId: null, title: "compaction test chat",
  }).returning();
  chatId = chat!.id;

  // One raw turn past COMPACT_THRESHOLD so a single maybeCompact() call folds something.
  const rowCount = COMPACT_THRESHOLD + 1;
  for (let i = 0; i < rowCount; i++) {
    await db.insert(messages).values({
      userId: alice.id, chatId,
      role: i % 2 === 0 ? "user" : "assistant",
      content: `turn ${i}`,
    });
  }
});

afterAll(async () => {
  // Cascades to messages and compaction_boundaries (schema.ts onDelete: "cascade").
  await db.delete(chats).where(eq(chats.id, chatId));
});

describe("maybeCompact — raw-turn preservation (§4)", () => {
  it("does nothing below the threshold", async () => {
    const [tinyChat] = await db.insert(chats).values({ userId: alice.id, title: "tiny" }).returning();
    await db.insert(messages).values({ userId: alice.id, chatId: tinyChat!.id, role: "user", content: "hi" });

    const result = await maybeCompact(tinyChat!.id, alice.id, fakeSummarize);
    expect(result).toBeNull();

    await db.delete(chats).where(eq(chats.id, tinyChat!.id));
  });

  it("writes a boundary once past the threshold, without touching message rows", async () => {
    const before = await db.select().from(messages).where(eq(messages.chatId, chatId)).orderBy(asc(messages.createdAt));
    expect(before).toHaveLength(COMPACT_THRESHOLD + 1);

    const result = await maybeCompact(chatId, alice.id, fakeSummarize);
    expect(result).not.toBeNull();
    expect(result!.summary).toContain("SUMMARY(");

    // THE property: every raw message is still there, byte-for-byte, after compaction.
    const after = await db.select().from(messages).where(eq(messages.chatId, chatId)).orderBy(asc(messages.createdAt));
    expect(after).toHaveLength(before.length);
    expect(after.map((m) => ({ id: m.id, content: m.content }))).toEqual(
      before.map((m) => ({ id: m.id, content: m.content })),
    );

    // The boundary points at a real message that is still readable underneath it.
    const [boundary] = await db.select().from(compactionBoundaries).where(eq(compactionBoundaries.chatId, chatId));
    expect(boundary?.upToMessageId).toBe(result!.throughMessageId);
    const pointedAt = after.find((m) => m.id === boundary!.upToMessageId);
    expect(pointedAt).toBeTruthy();

    // Exactly KEEP_RAW turns remain after the boundary.
    const idx = after.findIndex((m) => m.id === boundary!.upToMessageId);
    expect(after.length - (idx + 1)).toBe(KEEP_RAW);
  });

  it("is a no-op immediately after compacting (not enough new raw turns yet)", async () => {
    const result = await maybeCompact(chatId, alice.id, fakeSummarize);
    expect(result).toBeNull();
  });

  it("folds forward, carrying the prior summary, on a second compaction", async () => {
    for (let i = 0; i < COMPACT_THRESHOLD + 1; i++) {
      await db.insert(messages).values({
        userId: alice.id, chatId, role: i % 2 === 0 ? "user" : "assistant", content: `later ${i}`,
      });
    }

    const seenPriorSummary: string[] = [];
    const capturingSummarize = async (
      turns: { role: string; content: string }[],
      prior: string | null,
    ) => {
      if (prior) seenPriorSummary.push(prior);
      return `SUMMARY2(${turns.length})`;
    };

    const before = await db.select().from(messages).where(eq(messages.chatId, chatId));
    const result = await maybeCompact(chatId, alice.id, capturingSummarize);

    expect(result).not.toBeNull();
    expect(seenPriorSummary).toHaveLength(1);
    expect(seenPriorSummary[0]).toContain("SUMMARY(");

    const after = await db.select().from(messages).where(eq(messages.chatId, chatId));
    expect(after).toHaveLength(before.length); // still nothing deleted

    const boundaryRows = await db.select().from(compactionBoundaries).where(eq(compactionBoundaries.chatId, chatId));
    expect(boundaryRows).toHaveLength(2);
  });
});
