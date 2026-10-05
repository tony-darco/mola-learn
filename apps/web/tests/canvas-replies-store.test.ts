/**
 * A reply to one of the AI's annotations as a row (messages.annotation_id,
 * migration 0016): stored with the annotation's id and what the model was
 * told of it, handed to the panel with both (toClientMessage) — and kept,
 * thread and all, once the annotation is erased and the edit log has told it.
 *
 * Runs against the seeded local stack, like canvas-edit-log-sync.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import type { CanvasElement } from "@mola/shared";
import { artifacts, chats, db, messages, users } from "@mola/db";
import { annotate, newAnnotateTurn } from "../lib/canvas/annotate";
import type { CanvasContext } from "../lib/canvas/chat";
import { lockChat, syncEditLog, toClientMessage } from "../lib/canvas/chatServer";
import { repliedAnnotation } from "../lib/canvas/chatTurn";
import { readCanvas, type LabelMap } from "../lib/canvas/textSyntax";
import { textBox } from "../evals/canvas-reader/fixtures";

let aliceId: string;
let canvasId: string;
let chatId: string;
let version = 1;

const work = textBox("sum", 100, 100, "2 + 2 = 5");
const [k] = annotate(
  { annotations: [{ target: "X1", kind: "error", mark: "box", note: "2 + 2 is 4, not 5." }] },
  { elements: [work], doc: readCanvas([work]).doc }, newAnnotateTurn(),
).placed;

const payload = (elements: CanvasElement[]) => ({
  kind: "canvas", elements, viewport: { x: 0, y: 0, zoom: 1 }, background: { pattern: "dots", color: "#ffffff" },
});

/** Saves `elements` as the canvas's next version and syncs the chat's log, as a save and the panel's call after it would. */
async function saveAndSync(elements: CanvasElement[]) {
  version += 1;
  await db.update(artifacts).set({ payload: payload(elements), version }).where(eq(artifacts.id, canvasId));
  return db.transaction(async (tx) => {
    const chat = await lockChat(tx, chatId);
    const [canvas] = await tx.select().from(artifacts).where(eq(artifacts.id, canvasId));
    return (await syncEditLog(tx, chat, canvas!)).written;
  });
}

/** The chat as GET hands it to the panel. */
const stored = async () => (await db.select().from(messages).where(eq(messages.chatId, chatId)).orderBy(asc(messages.createdAt))).map(toClientMessage);

beforeAll(async () => {
  const [alice] = await db.select().from(users).where(eq(users.email, "alice@umbc.edu"));
  if (!alice) throw new Error("run `pnpm db:seed` first");
  aliceId = alice.id;
  const [canvas] = await db.insert(artifacts).values({
    userId: aliceId, kind: "canvas", title: "annotation replies test canvas", payload: payload([work, k!]), version,
  }).returning();
  canvasId = canvas!.id;
  const [chat] = await db.insert(chats).values({ userId: aliceId, canvasId, title: "annotation replies test chat" }).returning();
  chatId = chat!.id;
});

afterAll(async () => {
  await db.delete(chats).where(eq(chats.id, chatId));
  await db.delete(artifacts).where(eq(artifacts.id, canvasId));
});

describe("a reply to an annotation, stored", () => {
  it("keeps the annotation's id on the student's message, and what the model was told of it", async () => {
    // The log's first sync: the board as it stands, with K1 on it.
    expect(await saveAndSync([work, k!])).toEqual([]);
    const [chat] = await db.select().from(chats).where(eq(chats.id, chatId));
    const read = readCanvas([work, k!], { labels: (chat!.canvasLabels as LabelMap | null) ?? undefined });
    const replyTo = repliedAnnotation([work, k!], read.labels, k!.id)!;
    const context: CanvasContext = { text: read.text, region: null, replyTo };
    await db.insert(messages).values({ userId: aliceId, chatId, role: "user", content: "Why is it 4?", canvasContext: context, annotationId: k!.id });
    await db.insert(messages).values({ userId: aliceId, chatId, role: "assistant", content: "Count on 2 from 2." });

    const [reply, answer] = await stored();
    expect(reply).toMatchObject({ role: "user", content: "Why is it 4?", annotationId: k!.id, canvasContext: { replyTo: { label: "K1", kind: "error", target: "X1" } } });
    expect(answer).toMatchObject({ role: "assistant", annotationId: null });
  });

  it("keeps the reply and its answer, still naming the annotation, once the annotation is erased and logged", async () => {
    const [erased] = await saveAndSync([work]);
    expect(erased).toMatchObject({ role: "event", content: `You deleted K1: "2 + 2 is 4, not 5."` });
    expect((await stored()).map((m) => [m.role, m.content, m.role === "event" ? null : m.annotationId])).toEqual([
      ["user", "Why is it 4?", k!.id],
      ["assistant", "Count on 2 from 2.", null],
      ["event", `You deleted K1: "2 + 2 is 4, not 5."`, null],
    ]);
  });
});
