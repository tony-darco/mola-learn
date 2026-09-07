/**
 * One error→status mapping for the plan and task routes.
 *
 * `authzResponse` (contract 2) already owns 401/403/404 and stays the first
 * thing consulted, so an ownership failure can never be reshaped by anything
 * here. This adds only the three failures the planning engine raises that a
 * caller can act on: a malformed amendment, a missing field, and a model that
 * could not produce a valid payload — that last one is upstream's fault, not
 * the caller's, so it is a 502 rather than a 500.
 */
import { authzResponse } from "@/lib/auth/ownership";
import { PlanGenerationError } from "./generate";
import { AmendmentError } from "./payload";
import { TaskInputError } from "./lifecycle";

export function planningErrorResponse(err: unknown): Response {
  const authz = authzResponse(err);
  if (authz) return authz;

  if (err instanceof AmendmentError || err instanceof TaskInputError) {
    return Response.json({ error: err.message }, { status: 400 });
  }
  if (err instanceof PlanGenerationError) {
    return Response.json({ error: err.message }, { status: 502 });
  }

  console.error("planning route failed:", err);
  return Response.json({ error: "internal" }, { status: 500 });
}
