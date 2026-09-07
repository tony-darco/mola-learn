/**
 * Agent H — mind maps (§6, Phase 1.5, MVP+1 knowledge-graph seed). Same
 * architecture as flashcards.ts/quizzes.ts: create_mind_map is the only tool
 * of this module registered on the main registry; it spins a fresh
 * sub-agent scoped to grep/bm25/vector_search plus a private emit_mind_map
 * finishing tool that never reaches the top-level model's own tool list.
 *
 * Unlike flashcard/quiz ids, node ids here are NOT minted server-side — the
 * frozen mindMapNodeSchema's id is a plain string, not a uuid, and the model
 * has to invent and reuse its own ids to wire parentId/edges into a
 * consistent tree while it's still building it. What IS enforced server-side
 * is structural integrity: rootId must name a real node, every parentId must
 * name a real node (or be null, for the root alone), and every edge must
 * reference real nodes — a model inventing a plausible-looking but broken
 * tree is a real failure mode a discriminated union alone can't catch.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { type ArtifactToolResult, mindMapPayloadSchema } from "@mola/shared";
import type { Tool, ToolContext } from "../registry";
import { ToolRegistry } from "../registry";
import { runSubagent } from "../subagent";
import { withCallLogging } from "@/lib/debug/tool-log";
import { grepSearchTool } from "./grep-search";
import { bm25SearchTool } from "./bm25-search";
import { vectorSearchTool } from "./vector-search";

// See flashcards.ts's identical toolSourceRefSchema for why this exists.
const toolSourceRefSchema = z.object({
  documentId: z.string().uuid(),
  documentTitle: z.string(),
  locator: z.string().nullable(),
  chunkOrdinals: z.array(z.number().int().nonnegative()).optional(),
});

const emitNodeSchema = z.object({
  id: z.string().min(1).describe("A short id you invent, e.g. \"root\", \"n1\" — reused in parentId/edges"),
  label: z.string().min(1),
  parentId: z.string().nullable().describe("The id of this node's parent, or null only for the root node"),
  note: z.string().nullable().optional(),
  sources: z.array(toolSourceRefSchema).optional().describe(
    "Sources this specific node's content is grounded in — a subset of the map-level sources",
  ),
});

const emitInputSchema = z.object({
  title: z.string().min(1).describe("Mind map title, e.g. \"Vector Spaces — Core Concepts\""),
  topics: z.array(z.string()).optional(),
  sources: z.array(toolSourceRefSchema).optional(),
  rootId: z.string().min(1).describe("Must equal the id of exactly one node in \"nodes\""),
  nodes: z.array(emitNodeSchema).min(1),
  edges: z.array(z.object({
    from: z.string().min(1),
    to: z.string().min(1),
    label: z.string().nullable().optional(),
  })).optional().describe("Cross-links beyond the parent/child tree — e.g. \"builds on\", \"contrast with\""),
});

/**
 * Sub-agent-only — deliberately never passed to buildRegistry(). Validates
 * the tree is actually structurally sound (not just shape-valid) before
 * wrapping it as the artifact envelope the parent loop persists.
 */
const emitMindMapTool: Tool<z.infer<typeof emitInputSchema>> = {
  name: "emit_mind_map",
  description: "Finalize the mind map. Call this exactly once, after research, with the complete node tree.",
  inputSchema: emitInputSchema,
  label: () => "Writing mind map",

  async execute(input): Promise<ArtifactToolResult | { error: string }> {
    const nodeIds = new Set(input.nodes.map((n) => n.id));

    if (!nodeIds.has(input.rootId)) {
      return { error: `rootId "${input.rootId}" does not match any node id — call emit_mind_map again with a valid rootId` };
    }
    for (const n of input.nodes) {
      if (n.id !== input.rootId && (n.parentId === null || !nodeIds.has(n.parentId))) {
        return { error: `node "${n.id}" has an invalid parentId "${n.parentId}" — every non-root node needs a real parent` };
      }
    }
    for (const e of input.edges ?? []) {
      if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) {
        return { error: `edge references an unknown node id ("${e.from}" -> "${e.to}")` };
      }
    }

    const payload = mindMapPayloadSchema.parse({
      kind: "mind_map",
      rootId: input.rootId,
      nodes: input.nodes.map((n) => ({
        id: n.id, label: n.label, parentId: n.parentId, note: n.note ?? null,
        sources: (n.sources ?? []).map((s) => ({ ...s, chunkOrdinals: s.chunkOrdinals ?? [] })),
      })),
      edges: (input.edges ?? []).map((e) => ({ from: e.from, to: e.to, label: e.label ?? null })),
    });

    return {
      __artifact: true,
      kind: "mind_map",
      title: input.title,
      topics: input.topics ?? [],
      sources: (input.sources ?? []).map((s) => ({ ...s, chunkOrdinals: s.chunkOrdinals ?? [] })),
      payload,
      replacesArtifactId: null,
    };
  },
};

const createInputSchema = z.object({
  topic: z.string().min(1).describe("What the mind map should cover, e.g. \"vector spaces and subspaces\""),
});

const SYSTEM_PROMPT = `You are a mind-map-writing agent for a university student's course materials.

You have three search tools (grep_search, bm25_search, vector_search) and one
finishing tool (emit_mind_map).

Rules:
- Budget your research: 3-5 search calls total is enough for a whole map.
  Research once, broadly, then build the whole tree from what you already have.
- Every node must be grounded in something a tool actually returned — never
  invent a concept or relationship that didn't come from a retrieved chunk.
- Optionally, attach a node's "sources" array to name the specific document/
  locator its label and note came from — but only for a handful of the most
  important nodes (e.g. the root and 2-3 key branches). Leave "sources" out
  entirely on most nodes. This is a nice-to-have, not a per-node requirement —
  never slow down or hesitate over it, and never let it stop you from calling
  emit_mind_map. The map-level "sources" field is what actually matters.
- Structure: one root node (the topic itself), a handful of main-branch nodes
  (key concepts), and leaf nodes under each branch (definitions, examples,
  formulas). Two or three levels deep is usually right — don't build a single
  giant flat list, and don't go so deep it stops being skimmable.
- Use "edges" only for real cross-links that aren't parent/child — e.g. a
  theorem in one branch that depends on a definition in another. Most maps
  need few or none.
- The moment you decide you have enough material, call emit_mind_map IN THAT
  SAME TURN — do not send a text-only message announcing you're about to write it.
- If emit_mind_map returns an error about an invalid rootId, parentId, or edge,
  fix exactly that problem and call it again — don't restart your research.
- Never use emoji, in any output, for any reason.

Node shape — copy this exactly (most nodes omit "sources" entirely):
{"id": "n2", "label": "Linear independence", "parentId": "root", "note": "optional one-line elaboration or null"}
A key node MAY add sources like this instead:
{"id": "root", "label": "Vector Spaces", "parentId": null, "note": "...", "sources": [{"documentId": "<uuid from the tool result>", "documentTitle": "...", "locator": "ch.3", "chunkOrdinals": [12]}]}`;

export const createMindMapTool: Tool<z.infer<typeof createInputSchema>> = {
  name: "create_mind_map",
  description:
    "Generate a mind map (concept tree) grounded in the student's course documents. Use when the student asks " +
    "to map out, outline, or visualize how concepts on a topic relate.",
  inputSchema: createInputSchema,
  label: (input) => `Creating mind map: ${input.topic}`,

  async execute(input, ctx) {
    // This private sub-agent registry never passes through buildRegistry()
    // (tools/index.ts) — wrapped again here so its tool calls (research +
    // the final emit_mind_map) still reach the debug logger.
    const subRegistry = new ToolRegistry()
      .register(withCallLogging(grepSearchTool))
      .register(withCallLogging(bm25SearchTool))
      .register(withCallLogging(vectorSearchTool))
      .register(withCallLogging(emitMindMapTool));

    // think:false — see quizzes.ts's identical reasoning; building a tree
    // from already-retrieved material doesn't need reasoning, and the
    // 30-iteration headroom (below) exists to absorb this model's own
    // narrate-then-act habit, not to give it room to deliberate more.
    const mapCtx: ToolContext = { ...ctx, think: false };

    const { result } = await runSubagent(
      {
        label: `Mapping "${input.topic}"`,
        systemPrompt: SYSTEM_PROMPT,
        briefing:
          `Create a mind map on: ${input.topic}\n\n` +
          `Research budget: 3-5 search calls total, then build the whole tree in a single emit_mind_map call.`,
        toolAllowlist: ["grep_search", "bm25_search", "vector_search", "emit_mind_map"],
        maxIterations: 30,
      },
      subRegistry,
      mapCtx,
    );

    return result;
  },
};
