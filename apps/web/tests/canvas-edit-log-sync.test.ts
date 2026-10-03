/**
 * The edit log as rows in a canvas chat (lib/canvas/chatServer.ts
 * syncEditLog): a chat's first sync only takes a snapshot; each save after
 * that becomes entries, folded into the newest message only while it is an
 * entry — a message in between starts a new one — and a sync with nothing
 * new saved does nothing. The changes themselves are canvas-edit-log.test.ts.
 *
 * Runs against the seeded local stack, like hidden-canvas-chats.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import type { CanvasElement } from "@mola/shared";
import { artifacts, chats, db, messages, users } from "@mola/db";
import { lockChat, syncEditLog } from "../lib/canvas/chatServer";
import { textBox } from "../evals/canvas-reader/fixtures";

let aliceId: string;
let canvasId: string;
let chatId: string;
let version = 1;

const payload = (elements: CanvasElement[]) => ({
  kind: "canvas", elements, viewport: { x: 0, y: 0, zoom: 1 }, background: { pattern: "dots", color: "#ffffff" },
});

/** Saves `elements` as the canvas's next version, then syncs the chat's log, as a save and the panel's call after it would. */
async function saveAndSync(elements: CanvasElement[] | null) {
  if (elements) {
    version += 1;
    await db.update(artifacts).set({ payload: payload(elements), version }).where(eq(artifacts.id, canvasId));
  }
  return db.transaction(async (tx) => {
    const chat = await lockChat(tx, chatId);
    const [canvas] = await tx.select().from(artifacts).where(eq(artifacts.id, canvasId));
    return (await syncEditLog(tx, chat, canvas!)).written;
  });
}

const rows = () => db.select().from(messages).where(eq(messages.chatId, chatId)).orderBy(asc(messages.createdAt));

beforeAll(async () => {
  const [alice] = await db.select().from(users).where(eq(users.email, "alice@umbc.edu"));
  if (!alice) throw new Error("run `pnpm db:seed` first");
  aliceId = alice.id;
  const [canvas] = await db.insert(artifacts).values({
    userId: aliceId, kind: "canvas", title: "edit-log sync test canvas", payload: payload([]), version,
  }).returning();
  canvasId = canvas!.id;
  const [chat] = await db.insert(chats).values({ userId: aliceId, canvasId, title: "edit-log sync test chat" }).returning();
  chatId = chat!.id;
});

afterAll(async () => {
  await db.delete(chats).where(eq(chats.id, chatId));
  await db.delete(artifacts).where(eq(artifacts.id, canvasId));
});

describe("the edit log in a canvas chat", () => {
  it("first sync: a snapshot, no entries — the first message reads the whole board anyway", async () => {
    expect(await saveAndSync([textBox("t", 100, 100, "already here")])).toEqual([]);
    const [chat] = await db.select().from(chats).where(eq(chats.id, chatId));
    expect(chat!.canvasSnapshot).toMatchObject({ version, items: [{ label: "X1", kind: "text" }] });
    expect(await rows()).toEqual([]);
  });

  it("each save after that is an entry; one that carries on from the newest rewrites it", async () => {
    const [added] = await saveAndSync([textBox("t", 100, 100, "already here"), textBox("u", 100, 300, "x + 2")]);
    expect(added).toMatchObject({ role: "event", content: `You added a text box X2: "x + 2"` });
    expect(added!.event).toMatchObject({ actor: "user", action: "added", label: "X2", kind: "text", after: { text: "x + 2" } });

    const [grown] = await saveAndSync([textBox("t", 100, 100, "already here"), textBox("u", 100, 300, "x + 2 = 5")]);
    expect(grown).toMatchObject({ id: added!.id, content: `You added a text box X2: "x + 2 = 5"` });
    expect((await rows()).map((m) => m.content)).toEqual([`You added a text box X2: "x + 2 = 5"`]);
  });

  it("a sync with nothing new saved writes nothing", async () => {
    expect(await saveAndSync(null)).toEqual([]);
  });

  it("after a message, the same change is a new entry", async () => {
    await db.insert(messages).values({ userId: aliceId, chatId, role: "user", content: "Is that right?" });
    const [edited] = await saveAndSync([textBox("t", 100, 100, "already here"), textBox("u", 100, 300, "x + 2 = 6")]);
    expect(edited!.content).toBe(`You changed X2 from "x + 2 = 5" to "x + 2 = 6"`);
    expect((await rows()).map((m) => `${m.role}: ${m.content}`)).toEqual([
      `event: You added a text box X2: "x + 2 = 5"`,
      "user: Is that right?",
      `event: You changed X2 from "x + 2 = 5" to "x + 2 = 6"`,
    ]);
  });
});
