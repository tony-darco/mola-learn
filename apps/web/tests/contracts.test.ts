/**
 * Phase 0 exit criteria, as executable assertions.
 *
 * These guard the six frozen contracts. A Phase 1 agent that breaks one should
 * see it here rather than at integration checkpoint 1.
 * Requires the local stack: `pnpm up && pnpm db:migrate && pnpm db:seed`.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { asc, eq, sql } from "drizzle-orm";
import {
  EMBEDDING, EMBEDDING_TASK, artifactToolResultSchema, decodeSSE, encodeSSE,
  formatForEmbedding, isArtifactToolResult,
} from "@mola/shared";
import { chats, courses, db, users } from "@mola/db";
import { AuthzError, requireOwned } from "../lib/auth/ownership";
import { assembleContext } from "../lib/context/assemble";
import { buildRegistry } from "../lib/agent/tools";
import { canEscalate, escalate } from "../lib/context/hint-ladder";

let alice: { id: string }, bob: { id: string }, chat: { id: string; courseId: string | null };

beforeAll(async () => {
  const [a] = await db.select().from(users).where(eq(users.email, "alice@umbc.edu"));
  const [b] = await db.select().from(users).where(eq(users.email, "bob@umbc.edu"));
  if (!a || !b) throw new Error("run `pnpm db:seed` first");
  // No ORDER BY previously — with only the freshly-seeded chat this always
  // picked the right (only) row, but a dev DB that's since accumulated more
  // of alice's chats through manual testing can return any of them. The
  // seeded chat is always the oldest, so pin to that rather than "whichever
  // row Postgres happens to return first."
  const [c] = await db.select().from(chats).where(eq(chats.userId, a.id)).orderBy(asc(chats.createdAt)).limit(1);
  if (!c) throw new Error("run `pnpm db:seed` first");
  alice = a; bob = b; chat = c;
});

describe("contract 2 — ownership (§9)", () => {
  it("returns the row for its owner", async () => {
    const row = await requireOwned("chat", chat.id, { userId: alice.id, email: "a" });
    expect(row.id).toBe(chat.id);
  });

  it("denies a different signed-in user", async () => {
    await expect(
      requireOwned("chat", chat.id, { userId: bob.id, email: "b" }),
    ).rejects.toBeInstanceOf(AuthzError);
  });

  it("denies an unauthenticated caller with 401", async () => {
    await expect(requireOwned("chat", chat.id, null)).rejects.toMatchObject({ status: 401 });
  });

  it("makes a foreign row indistinguishable from a missing one", async () => {
    const denial = async (id: string): Promise<AuthzError> => {
      try {
        await requireOwned("chat", id, { userId: bob.id, email: "b" });
      } catch (e) {
        if (e instanceof AuthzError) return e;
      }
      throw new Error("expected an AuthzError");
    };
    const foreign = await denial(chat.id);
    const missing = await denial("00000000-0000-0000-0000-000000000000");
    expect(foreign.status).toBe(missing.status);
    expect(foreign.message).toBe(missing.message);
  });
});

describe("contract 5 — five-layer context assembly (§5)", () => {
  it("returns all five layers, deterministically", async () => {
    const ctx = await assembleContext({
      userId: alice.id, chatId: chat.id, courseId: chat.courseId,
      tools: buildRegistry(), hintRung: null,
    });
    for (const layer of ["identity", "calendar", "catalog", "rules", "history"] as const) {
      expect(ctx.layers[layer], `layer ${layer} must be present`).toBeTruthy();
    }
  });

  it("layer 1 reads the course summary from the courses row — one source of truth (§8)", async () => {
    const [course] = await db.select().from(courses).where(eq(courses.id, chat.courseId!));
    expect(course?.summary).toBeTruthy();
    const ctx = await assembleContext({
      userId: alice.id, chatId: chat.id, courseId: course!.id,
      tools: buildRegistry(), hintRung: null,
    });
    expect(ctx.layers.identity).toContain(course!.summary!.slice(0, 40));
  });

  it("layer 3 injects tool names and one-line descriptions only", async () => {
    const ctx = await assembleContext({
      userId: alice.id, chatId: chat.id, courseId: chat.courseId,
      tools: buildRegistry(), hintRung: null,
    });
    expect(ctx.layers.catalog).toContain("read_course_fact");
    // The full zod schema must never reach the always-loaded layer.
    expect(ctx.layers.catalog).not.toContain("inputSchema");
  });
});

describe("layer 4 — hint ladder (§3)", () => {
  it("fades in from pointing and clamps at bottom_out", () => {
    expect(escalate(null)).toBe("pointing");
    expect(escalate("pointing")).toBe("teaching");
    expect(escalate("teaching")).toBe("bottom_out");
    expect(escalate("bottom_out")).toBe("bottom_out");
  });

  it("stops offering escalation at the bottom-out rung", () => {
    expect(canEscalate("teaching")).toBe(true);
    expect(canEscalate("bottom_out")).toBe(false);
  });
});

describe("contract 4 — tool registry", () => {
  it("exposes a catalog and generates JSON Schema for the provider", () => {
    const r = buildRegistry();
    expect(r.catalog().map((t) => t.name)).toContain("read_course_fact");
    const spec = r.specs().find((s) => s.name === "read_course_fact")!;
    expect(spec.parameters).toMatchObject({ type: "object" });
  });

  it("rejects an allowlist naming an unknown tool", () => {
    expect(() => buildRegistry().subset(["nope"])).toThrow(/unknown tool/);
  });

  it("validates tool input against the zod schema", async () => {
    await expect(
      buildRegistry().run("read_course_fact", { field: "not_a_field" }, {
        session: { userId: alice.id, email: "a" }, chatId: chat.id, courseId: chat.courseId,
      }),
    ).rejects.toThrow(/invalid input/);
  });
});

describe("contract 6 — artifacts and stream taxonomy", () => {
  it("round-trips an SSE event", () => {
    const ev = { type: "text_delta", text: "hi" } as const;
    expect(decodeSSE(encodeSSE(ev).trim())).toEqual(ev);
  });

  it("recognises an artifact tool result by its envelope", () => {
    const envelope = artifactToolResultSchema.parse({
      __artifact: true, kind: "flashcard_deck", title: "Ch.3",
      payload: { kind: "flashcard_deck", cards: [] },
    });
    expect(isArtifactToolResult(envelope)).toBe(true);
    expect(isArtifactToolResult({ text: "plain" })).toBe(false);
  });
});

describe("contract 3 — embedding config (S1.4 resolved)", () => {
  it("is frozen at the model's native width", () => {
    expect(EMBEDDING.model).toBe("qwen3-embedding:0.6b");
    expect(EMBEDDING.dim).toBe(1024);
  });

  it("matches the vector column width in Postgres", async () => {
    const [row] = await db.execute(sql`
      select a.atttypmod as width
      from pg_attribute a
      where a.attrelid = 'document_chunks'::regclass and a.attname = 'embedding'
    `);
    // A drift here means the schema and the model disagree, which corrupts the
    // index silently rather than erroring.
    expect((row as { width: number }).width).toBe(EMBEDDING.dim);
  });

  it("prefixes queries but never documents (the asymmetry)", () => {
    const raw = "why does the working set model reduce thrashing";
    expect(formatForEmbedding(raw, "document")).toBe(raw);
    expect(formatForEmbedding(raw, "query")).toBe(
      `Instruct: ${EMBEDDING_TASK}\nQuery: ${raw}`,
    );
  });

  it("keeps the two sides genuinely distinct", () => {
    const t = "page replacement";
    expect(formatForEmbedding(t, "query")).not.toBe(formatForEmbedding(t, "document"));
  });
});
