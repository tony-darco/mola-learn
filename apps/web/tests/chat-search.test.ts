/**
 * Chat search agent tests (§6, "Chat search agent (grep + BM25 only)").
 *
 * Covers: grepChats/bm25Chats independently, that both search raw message
 * turns AND compaction summaries and a summary hit points back at the raw
 * turns it condensed (upToMessageId), §9 ownership scoping (alice cannot see
 * bob's chats), and tool registration through the real ToolRegistry.
 *
 * grepChats/bm25Chats take an explicit userId (no requireSession() call, per
 * lib/auth/session.ts's own docstring on why that matters), so this suite
 * runs under plain Vitest against the seeded local stack
 * (`pnpm up && pnpm db:migrate && pnpm db:seed`).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { chats, compactionBoundaries, db, messages, users } from "@mola/db";
import { grepChats, bm25Chats } from "../lib/agent/chat-search/queries";
import { grepChatSearchTool } from "../lib/agent/tools/grep-chat-search";
import { bm25ChatSearchTool } from "../lib/agent/tools/bm25-chat-search";
import { buildRegistry } from "../lib/agent/tools";
import type { ToolContext } from "../lib/agent/registry";

let alice: { id: string }, bob: { id: string };
let aliceChatId: string, bobChatId: string;
let aliceMessageId: string;
let ctx: ToolContext;

beforeAll(async () => {
  const [a] = await db.select().from(users).where(eq(users.email, "alice@umbc.edu"));
  const [b] = await db.select().from(users).where(eq(users.email, "bob@umbc.edu"));
  if (!a || !b) throw new Error("run `pnpm db:seed` first");
  alice = a;
  bob = b;

  const [aliceChat] = await db
    .insert(chats)
    .values({ userId: alice.id, courseId: null, title: "chat-search-test alice chat" })
    .returning();
  aliceChatId = aliceChat!.id;

  const [bobChat] = await db
    .insert(chats)
    .values({ userId: bob.id, courseId: null, title: "chat-search-test bob chat" })
    .returning();
  bobChatId = bobChat!.id;

  const [msg1] = await db
    .insert(messages)
    .values({
      userId: alice.id, chatId: aliceChatId, role: "user",
      content: "Can you remind me what we worked out about EIGENVECTORMARK last week?",
    })
    .returning();
  aliceMessageId = msg1!.id;

  await db.insert(messages).values({
    userId: alice.id, chatId: aliceChatId, role: "assistant",
    content: "Sure — an EIGENVECTORMARK is a vector that only scales under a linear transform.",
  });

  await db.insert(compactionBoundaries).values({
    userId: alice.id, chatId: aliceChatId, upToMessageId: aliceMessageId,
    summary: "Discussed COMPACTSUMMARYMARK and how eigenvectors relate to diagonalization.",
  });

  await db.insert(messages).values({
    userId: bob.id, chatId: bobChatId, role: "user",
    content: "This mentions EIGENVECTORMARK too but belongs to bob.",
  });

  ctx = { session: { userId: alice.id, email: "alice@umbc.edu" }, chatId: aliceChatId, courseId: null };
});

afterAll(async () => {
  // Cascades to messages + compaction_boundaries for each chat.
  await db.delete(chats).where(eq(chats.id, aliceChatId));
  await db.delete(chats).where(eq(chats.id, bobChatId));
});

describe("grepChats", () => {
  it("finds an exact literal substring in a raw message turn", async () => {
    const hits = await grepChats("EIGENVECTORMARK", { userId: alice.id });
    expect(hits.some((h) => h.source === "message" && h.text.includes("EIGENVECTORMARK"))).toBe(true);
  });

  it("finds a hit in a compaction summary and points back at the raw turn it condensed", async () => {
    const hits = await grepChats("COMPACTSUMMARYMARK", { userId: alice.id });
    const summaryHit = hits.find((h) => h.source === "summary");
    expect(summaryHit).toBeTruthy();
    expect(summaryHit!.text).toContain("COMPACTSUMMARYMARK");
    expect(summaryHit!.messageId).toBe(aliceMessageId);
  });

  it("never returns another user's chats", async () => {
    const hits = await grepChats("EIGENVECTORMARK", { userId: alice.id });
    expect(hits.every((h) => h.chatId !== bobChatId)).toBe(true);
  });

  it("reports no hits rather than throwing when nothing matches", async () => {
    const hits = await grepChats("NO-SUCH-TOKEN-XYZ-CHAT", { userId: alice.id });
    expect(hits).toEqual([]);
  });
});

describe("bm25Chats", () => {
  it("ranks a raw message turn by keyword relevance", async () => {
    const hits = await bm25Chats("EIGENVECTORMARK scales linear transform", { userId: alice.id });
    expect(hits.some((h) => h.source === "message" && h.text.includes("EIGENVECTORMARK"))).toBe(true);
  });

  it("ranks a compaction summary by keyword relevance", async () => {
    const hits = await bm25Chats("COMPACTSUMMARYMARK diagonalization", { userId: alice.id });
    expect(hits.some((h) => h.source === "summary" && h.text.includes("COMPACTSUMMARYMARK"))).toBe(true);
  });

  it("never returns another user's chats", async () => {
    const hits = await bm25Chats("EIGENVECTORMARK", { userId: alice.id });
    expect(hits.every((h) => h.chatId !== bobChatId)).toBe(true);
  });
});

describe("tool: grep_chat_search", () => {
  it("returns a formatted observation containing the hit", async () => {
    const result = (await grepChatSearchTool.execute({ pattern: "EIGENVECTORMARK" }, ctx)) as string;
    expect(result).toContain("EIGENVECTORMARK");
    expect(result).toContain("chat-search-test alice chat");
  });
});

describe("tool: bm25_chat_search", () => {
  it("returns a formatted observation containing the hit", async () => {
    const result = (await bm25ChatSearchTool.execute({ query: "EIGENVECTORMARK linear transform" }, ctx)) as string;
    expect(result).toContain("EIGENVECTORMARK");
  });
});

describe("registration", () => {
  it("registers both chat-search tools on the live registry", () => {
    const names = buildRegistry().catalog().map((t) => t.name);
    expect(names).toContain("grep_chat_search");
    expect(names).toContain("bm25_chat_search");
  });
});
