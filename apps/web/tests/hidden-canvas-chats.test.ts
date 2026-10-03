/**
 * A canvas's own chat (chats.canvas_id set) lives in that canvas's chat
 * panel, and for now stays out of every other list and search of the user's
 * chats. Here: the tutor's chat search (grep and BM25, over raw turns and
 * compaction summaries) and a course page's chat list. The sidebar list, its
 * search box and the /chats landing are checked end to end in
 * e2e/canvas-selection.spec.ts.
 *
 * Its edit log (messages with role "event") stays out of search and of a
 * normal chat's history too, even in a chat that has outlived its canvas.
 *
 * Runs against the seeded local stack, like chat-search.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { artifacts, chats, compactionBoundaries, courses, db, messages, users } from "@mola/db";
import { bm25Chats, grepChats } from "../lib/agent/chat-search/queries";
import { buildRegistry } from "../lib/agent/tools";
import { assembleContext } from "../lib/context/assemble";
import { listCourseChats } from "../lib/courses/actions";

let aliceId: string;
let courseId: string;
let canvasId: string;
let canvasChatId: string;
let normalChatId: string;

beforeAll(async () => {
  const [alice] = await db.select().from(users).where(eq(users.email, "alice@umbc.edu"));
  if (!alice) throw new Error("run `pnpm db:seed` first");
  aliceId = alice.id;
  const [course] = await db.select().from(courses).where(eq(courses.userId, aliceId)).limit(1);
  if (!course) throw new Error("alice has no course — run `pnpm db:seed` first");
  courseId = course.id;

  const [canvas] = await db.insert(artifacts).values({
    userId: aliceId, kind: "canvas", title: "hidden-canvas-chats test canvas",
    payload: { kind: "canvas", elements: [], viewport: { x: 0, y: 0, zoom: 1 }, background: { pattern: "dots", color: "#ffffff" } },
  }).returning();
  canvasId = canvas!.id;

  // Same course and the same words in both, so the only difference is canvas_id.
  for (const canvas of [canvasId, null]) {
    const [chat] = await db.insert(chats).values({
      userId: aliceId, courseId, canvasId: canvas, title: canvas ? "hidden canvas chat" : "visible normal chat",
    }).returning();
    const [msg] = await db.insert(messages).values({
      userId: aliceId, chatId: chat!.id, role: "user", content: "What does CANVASHIDEMARK mean for row reduction?",
    }).returning();
    await db.insert(compactionBoundaries).values({
      userId: aliceId, chatId: chat!.id, upToMessageId: msg!.id, summary: "Talked through CANVASHIDESUMMARY and pivots.",
    });
    if (canvas) canvasChatId = chat!.id;
    else normalChatId = chat!.id;
  }
  // An edit-log entry left in a chat whose canvas is gone (chats.canvas_id is set null then).
  await db.insert(messages).values({
    userId: aliceId, chatId: normalChatId, role: "event", content: "You wrote T1: \"CANVASEVENTMARK\"",
    event: { actor: "user", action: "added", label: "T1", kind: "writing", pen: true, after: { text: "CANVASEVENTMARK" } },
  });
});

afterAll(async () => {
  // Cascades to their messages and compaction boundaries.
  await db.delete(chats).where(inArray(chats.id, [canvasChatId, normalChatId]));
  await db.delete(artifacts).where(eq(artifacts.id, canvasId));
});

describe("a canvas's own chat stays out of", () => {
  it("grep chat search, over raw turns and summaries", async () => {
    for (const pattern of ["CANVASHIDEMARK", "CANVASHIDESUMMARY"]) {
      const hits = await grepChats(pattern, { userId: aliceId });
      expect(hits.map((h) => h.chatId)).toContain(normalChatId);
      expect(hits.map((h) => h.chatId)).not.toContain(canvasChatId);
    }
  });

  it("BM25 chat search, over raw turns and summaries", async () => {
    for (const query of ["CANVASHIDEMARK row reduction", "CANVASHIDESUMMARY pivots"]) {
      const hits = await bm25Chats(query, { userId: aliceId });
      expect(hits.map((h) => h.chatId)).toContain(normalChatId);
      expect(hits.map((h) => h.chatId)).not.toContain(canvasChatId);
    }
  });

  it("a course page's chat list", async () => {
    const ids = (await listCourseChats(aliceId, courseId)).map((c) => c.id);
    expect(ids).toContain(normalChatId);
    expect(ids).not.toContain(canvasChatId);
  });
});

describe("a canvas chat's edit log stays out of", () => {
  it("grep and BM25 chat search", async () => {
    expect(await grepChats("CANVASEVENTMARK", { userId: aliceId })).toEqual([]);
    expect(await bm25Chats("CANVASEVENTMARK", { userId: aliceId })).toEqual([]);
  });

  it("the history a normal chat sends the model", async () => {
    const ctx = await assembleContext({ userId: aliceId, chatId: normalChatId, courseId, tools: buildRegistry(), hintRung: null });
    expect(ctx.messages.map((m) => m.role)).toEqual(["system", "user"]); // the compaction summary, then the turn
    expect(ctx.messages.some((m) => m.content.includes("CANVASEVENTMARK"))).toBe(false);
  });
});
