/**
 * In-memory registry of the AbortController backing each turn currently
 * generating in this process, keyed by the assistant message id.
 *
 * Resumable-chat-state fix: `ToolContext.signal` must never be the incoming
 * request's own `req.signal` — that fires on ANY loss of the client
 * connection (a same-tab navigation away, a closed tab, a dropped network
 * link), which would silently abort generation the instant nobody happens to
 * be watching. This registry is what an EXPLICIT Stop click cancels instead
 * (see the `stop` route) — generation now only ever ends early on purpose.
 *
 * Cached on `globalThis` for the same reason as the db client (client.ts):
 * Next.js can re-evaluate a route module between the POST that registers a
 * controller and a later request to the stop route, which would otherwise
 * land in a fresh, empty Map that never sees the earlier registration.
 */
const globalForRegistry = globalThis as unknown as {
  __molaGenerationControllers?: Map<string, AbortController>;
};

const controllers = globalForRegistry.__molaGenerationControllers ?? new Map<string, AbortController>();
globalForRegistry.__molaGenerationControllers = controllers;

/** Call once, right before a turn starts generating. */
export function registerGeneration(messageId: string): AbortController {
  const controller = new AbortController();
  controllers.set(messageId, controller);
  return controller;
}

/** Call once the turn reaches any terminal state, success or failure. */
export function unregisterGeneration(messageId: string): void {
  controllers.delete(messageId);
}

/** Returns true if a live generation was found and aborted. */
export function stopGeneration(messageId: string): boolean {
  const controller = controllers.get(messageId);
  if (!controller) return false;
  controller.abort();
  return true;
}
