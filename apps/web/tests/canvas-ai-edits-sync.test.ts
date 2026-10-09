/**
 * What the AI changed, kept until a page has applied it to the board
 * (lib/canvas/chatServer.ts): recorded as pending — what it added, and its
 * edits and moves of what was there, with the element as it was before —
 * handed back oldest first, and pending no more once a save acknowledges
 * it — whether the board still holds it or the student has already erased
 * or undone it — and only on its own canvas. And its edits and moves in the
 * edit log as its own, once a save brings them (syncEditLog).
 *
 * Runs against the seeded local stack, like canvas-edit-log-sync.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import type { CanvasAnnotationElement, CanvasElement } from "@mola/shared";
import { artifacts, canvasAiEdits, chats, db, messages, users } from "@mola/db";
import { addedByAI, type AIChange } from "../lib/canvas/chat";
import { lockChat, markAIEditsApplied, pendingAIEdits, recordAIEdits, syncEditLog } from "../lib/canvas/chatServer";
import { shape, textBox } from "../evals/canvas-reader/fixtures";

const canvases: string[] = [];
let aliceId: string;
let chatId: string;
let messageId: string;

const annotation = (id: string): CanvasAnnotationElement => ({
  id, parentId: null, index: "a0", x: 0, y: 0, width: 20, height: 30, rotation: 0, opacity: 1, createdBy: "ai", type: "annotation",
  props: { kind: "error", mark: "circle", note: "Not this.", target: "T1 word 1", targetIds: ["w0"] },
});

async function newCanvas() {
  const [canvas] = await db.insert(artifacts).values({
    userId: aliceId, kind: "canvas", title: "AI edits test canvas",
    payload: { kind: "canvas", elements: [], viewport: { x: 0, y: 0, zoom: 1 }, background: { pattern: "dots", color: "#ffffff" } },
  }).returning();
  canvases.push(canvas!.id);
  return canvas!.id;
}

const pendingIds = async (canvasId: string) => (await pendingAIEdits(canvasId)).map((p) => p.element.id);
const acknowledge = (canvasId: string, ids: string[]) => db.transaction((tx) => markAIEditsApplied(tx, canvasId, ids));

beforeAll(async () => {
  const [alice] = await db.select().from(users).where(eq(users.email, "alice@umbc.edu"));
  if (!alice) throw new Error("run `pnpm db:seed` first");
  aliceId = alice.id;
  const canvasId = await newCanvas();
  const [chat] = await db.insert(chats).values({ userId: aliceId, canvasId, title: "AI edits test chat" }).returning();
  chatId = chat!.id;
  const [message] = await db.insert(messages).values({ userId: aliceId, chatId, role: "assistant", content: "" }).returning();
  messageId = message!.id;
});

afterAll(async () => {
  await db.delete(chats).where(eq(chats.id, chatId));
  for (const id of canvases) await db.delete(artifacts).where(eq(artifacts.id, id));
});

describe("the AI's edits, until a page has put them on the board", () => {
  it("are pending from the moment they're placed, oldest first, with the reply that placed them", async () => {
    const canvasId = canvases[0]!;
    const k1 = annotation(crypto.randomUUID());
    const [k2, k3] = [annotation(crypto.randomUUID()), annotation(crypto.randomUUID())];
    await recordAIEdits(canvasId, aliceId, messageId, [addedByAI(k1)]);
    await recordAIEdits(canvasId, aliceId, messageId, [k2, k3].map(addedByAI));
    expect(await pendingAIEdits(canvasId)).toEqual([k1, k2, k3].map((element) => ({ messageId, id: element.id, element, before: null })));
  });

  it("stop being pending once a save acknowledges them — on the board or already erased — and only on their own canvas", async () => {
    const canvasId = canvases[0]!;
    const [k1, k2, k3] = await pendingIds(canvasId);
    const other = await newCanvas();

    // The save that first holds k1, with k2 already erased before it: both acknowledged; a stray id and another canvas's ignored.
    await acknowledge(canvasId, [k1!, k2!, "not-an-edit"]);
    await acknowledge(other, [k3!]);
    expect(await pendingIds(canvasId)).toEqual([k3]);

    // Acknowledged again later (still on the board), nothing changes; k3 goes with the next save.
    await acknowledge(canvasId, [k1!, k3!]);
    expect(await pendingIds(canvasId)).toEqual([]);
    const rows = await db.select().from(canvasAiEdits).where(eq(canvasAiEdits.canvasId, canvasId));
    expect(rows.every((r) => r.appliedAt instanceof Date)).toBe(true);
  });

  it("go with their canvas", async () => {
    const canvasId = canvases[0]!;
    await db.delete(artifacts).where(eq(artifacts.id, canvasId));
    expect(await db.select().from(canvasAiEdits).where(eq(canvasAiEdits.canvasId, canvasId))).toEqual([]);
  });
});

describe("the AI's edits and moves of what was on the board", () => {
  const typo = textBox("x1", 100, 100, "teh answer");
  const box = shape("s1", "rectangle", 400, 100, 80, 60);
  const fixed: AIChange = { id: crypto.randomUUID(), before: typo, element: { ...typo, props: { ...typo.props, text: "the answer" } } as CanvasElement };
  const moved: AIChange = { id: crypto.randomUUID(), before: box, element: { ...box, x: 600 } };
  let canvasId: string;
  let logChatId: string;
  let replyId: string;
  let version = 1;

  const payload = (elements: CanvasElement[]) => ({ kind: "canvas", elements, viewport: { x: 0, y: 0, zoom: 1 }, background: { pattern: "dots", color: "#ffffff" } });
  /** Saves `elements` as the canvas's next version, acknowledging `applied`, then syncs the chat's log — as a save and the panel's call after it would. */
  async function saveAndSync(elements: CanvasElement[], applied: string[] = []) {
    version += 1;
    await db.update(artifacts).set({ payload: payload(elements), version }).where(eq(artifacts.id, canvasId));
    await acknowledge(canvasId, applied);
    return db.transaction(async (tx) => {
      const chat = await lockChat(tx, logChatId);
      const [canvas] = await tx.select().from(artifacts).where(eq(artifacts.id, canvasId));
      return (await syncEditLog(tx, chat, canvas!)).written.map((m) => m.content);
    });
  }

  beforeAll(async () => {
    canvasId = await newCanvas();
    const [chat] = await db.insert(chats).values({ userId: aliceId, canvasId, title: "AI edits log test chat" }).returning();
    logChatId = chat!.id;
    const [reply] = await db.insert(messages).values({ userId: aliceId, chatId: logChatId, role: "assistant", content: "" }).returning();
    replyId = reply!.id;
  });

  afterAll(async () => {
    await db.delete(chats).where(eq(chats.id, logChatId));
  });

  it("are pending with the element as it was before, by the change's own id, until a save acknowledges them", async () => {
    const added: CanvasElement = { ...shape("ai-s", "ellipse", 0, 0, 10, 10), id: crypto.randomUUID(), createdBy: "ai" };
    await recordAIEdits(canvasId, aliceId, replyId, [fixed, addedByAI(added), moved]);
    expect(await pendingAIEdits(canvasId)).toEqual([
      { messageId: replyId, ...fixed }, { messageId: replyId, ...addedByAI(added) }, { messageId: replyId, ...moved },
    ]);
    await acknowledge(canvasId, [added.id]);
    expect((await pendingAIEdits(canvasId)).map((p) => p.id)).toEqual([fixed.id, moved.id]);
  });

  it("are logged as the AI's once a save brings them; the student's changes after them, and their undoing them, as the student's", async () => {
    expect(await saveAndSync([typo, box])).toEqual([]);

    expect(await saveAndSync([fixed.element, moved.element], [fixed.id, moved.id])).toEqual([`Mola changed X1 from "teh answer" to "the answer"`, "Mola moved S1"]);
    expect(await pendingAIEdits(canvasId)).toEqual([]);
    const logged = await db.select().from(messages).where(eq(messages.chatId, logChatId)).orderBy(asc(messages.createdAt));
    expect(logged.filter((m) => m.role === "event").map((m) => (m.event as { actor: string }).actor)).toEqual(["ai", "ai"]);

    const typed = { ...fixed.element, props: { ...typo.props, text: "the answer!" } } as CanvasElement;
    expect(await saveAndSync([typed, moved.element])).toEqual([`You changed X1 from "the answer" to "the answer!"`]);
    expect(await saveAndSync([typed, box])).toEqual(["You moved S1"]);
  });
});
