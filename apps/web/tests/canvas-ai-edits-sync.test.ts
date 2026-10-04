/**
 * What the AI placed, kept until a page has put it on the board
 * (lib/canvas/chatServer.ts): recorded as pending, handed back oldest first,
 * and pending no more once a save acknowledges it — whether the board still
 * holds it or the student has already erased it — and only on its own canvas.
 *
 * Runs against the seeded local stack, like canvas-edit-log-sync.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { CanvasAnnotationElement } from "@mola/shared";
import { artifacts, canvasAiEdits, chats, db, messages, users } from "@mola/db";
import { markAIEditsApplied, pendingAIEdits, recordAIEdits } from "../lib/canvas/chatServer";

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
    await recordAIEdits(canvasId, aliceId, messageId, [k1]);
    await recordAIEdits(canvasId, aliceId, messageId, [k2, k3]);
    expect(await pendingAIEdits(canvasId)).toEqual([k1, k2, k3].map((element) => ({ messageId, element })));
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
