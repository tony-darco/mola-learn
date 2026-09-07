import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    // Several suites (planning.test.ts, calendar-tools.test.ts) mutate real
    // rows for the shared seeded `alice@umbc.edu` — the same "today" day plan
    // and task set — rather than a per-file fixture user. Vitest's default
    // file-level parallelism let two such files race on the same rows and
    // produced a real, reproduced flake (a Layer 2 assertion reading back
    // whichever file's insert happened to land last). Serial execution is the
    // narrow fix; the durable one is per-file test users, left as a follow-up
    // since it touches every DB-backed suite, not just the two that collided.
    fileParallelism: false,
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
});
