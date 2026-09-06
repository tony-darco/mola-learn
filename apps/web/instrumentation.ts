/**
 * Runs once when the Next.js server process starts (dev and prod — Next's own
 * `instrumentation.ts` convention). Next also prepares an edge-runtime bundle
 * of this file, which can't resolve Node built-ins (e.g. `net`, pulled in by
 * postgres.js) — the dynamic import below is the documented way to keep that
 * bundle from ever needing to resolve the nodejs-only code path at all.
 *
 * See lib/chat/startup-sweep.ts for what this actually does and why.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./lib/chat/startup-sweep");
  }
}
