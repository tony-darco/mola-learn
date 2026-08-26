import { ToolRegistry } from "../registry";
import { courseFactsTool } from "./course-facts";

/**
 * The single place tools are wired up. Phase 1 agents add their tools HERE
 * rather than constructing their own registry, so Layer 3's catalog and the
 * provider's tool specs stay in sync automatically.
 */
export function buildRegistry(): ToolRegistry {
  return new ToolRegistry().register(courseFactsTool);
}
