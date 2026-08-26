/**
 * CONTRACT 4 (part 1) — the tool registry. FROZEN, and working from Phase 0.
 *
 * Agent C registers the three retrieval tools through this exact mechanism.
 * It ships as real code rather than a type shape specifically so C consumes a
 * contract instead of a mock that would drift before checkpoint 1 (plan S4).
 */
import { z } from "zod";
import type { Session } from "../auth/session";
import type { ToolSpec } from "../llm/types";

export type ToolContext = {
  session: Session;
  chatId: string;
  courseId: string | null;
  signal?: AbortSignal;
};

export type Tool<I = unknown> = {
  name: string;
  /** The ONE line injected into Layer 3. Full instructions load on demand (§5). */
  description: string;
  inputSchema: z.ZodType<I>;
  /** Collapsed-row label for the tool_call_start stream event. */
  label?: (input: I) => string;
  execute(input: I, ctx: ToolContext): Promise<unknown>;
};

export class ToolRegistry {
  private readonly tools = new Map<string, Tool<never>>();

  register<I>(tool: Tool<I>): this {
    if (this.tools.has(tool.name)) throw new Error(`duplicate tool: ${tool.name}`);
    this.tools.set(tool.name, tool as unknown as Tool<never>);
    return this;
  }

  get(name: string): Tool<never> | undefined {
    return this.tools.get(name);
  }

  /** Restricted view for a sub-agent's tool allowlist (§4). */
  subset(names: readonly string[]): ToolRegistry {
    const r = new ToolRegistry();
    for (const n of names) {
      const t = this.tools.get(n);
      if (!t) throw new Error(`unknown tool in allowlist: ${n}`);
      r.register(t);
    }
    return r;
  }

  /** Name + one-line description only — what Layer 3 injects (§5). */
  catalog(): { name: string; description: string }[] {
    return [...this.tools.values()].map((t) => ({ name: t.name, description: t.description }));
  }

  /** Full JSON Schema, sent to the provider only when tools are actually offered. */
  specs(): ToolSpec[] {
    return [...this.tools.values()].map((t) => ({
      name: t.name,
      description: t.description,
      parameters: toJsonSchema(t.inputSchema),
    }));
  }

  async run(name: string, rawInput: unknown, ctx: ToolContext): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`unknown tool: ${name}`);
    const parsed = tool.inputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new Error(`invalid input for ${name}: ${parsed.error.message}`);
    }
    return tool.execute(parsed.data as never, ctx);
  }

  labelFor(name: string, input: unknown): string {
    const tool = this.tools.get(name);
    if (!tool?.label) return name;
    try {
      return tool.label(input as never);
    } catch {
      return name;
    }
  }
}

/** Minimal zod→JSON Schema. Covers the shapes our tools actually use. */
function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const def = (schema as unknown as { _def: { typeName: string } })._def;

  switch (def.typeName) {
    case "ZodObject": {
      const shape = (schema as unknown as z.ZodObject<z.ZodRawShape>).shape;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = toJsonSchema(value as z.ZodType);
        if (!(value as z.ZodType).isOptional()) required.push(key);
      }
      return { type: "object", properties, required };
    }
    case "ZodString":
      return { type: "string", ...describe(schema) };
    case "ZodNumber":
      return { type: "number", ...describe(schema) };
    case "ZodBoolean":
      return { type: "boolean", ...describe(schema) };
    case "ZodArray":
      return {
        type: "array",
        items: toJsonSchema((def as unknown as { type: z.ZodType }).type),
        ...describe(schema),
      };
    case "ZodEnum":
      return { type: "string", enum: (def as unknown as { values: string[] }).values };
    case "ZodOptional":
    case "ZodNullable":
    case "ZodDefault":
      return toJsonSchema((def as unknown as { innerType: z.ZodType }).innerType);
    default:
      return {};
  }
}

function describe(schema: z.ZodType): Record<string, unknown> {
  const d = (schema as unknown as { description?: string }).description;
  return d ? { description: d } : {};
}
