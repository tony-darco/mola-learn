import { defineConfig, devices } from "@playwright/test";

/**
 * E2E regression suite (testing-only workstream — see e2e/README in the repo
 * root task notes). Boots the real Next.js dev server against the dedicated
 * `mola_e2e` database on port 3020 so it never collides with the user's own
 * session (3000), the UI-redesign agent (3010), or other agents' ports.
 *
 * A handful of specs make a real round trip to the LAN Ollama host (hint
 * ladder, tool calls) — those set their own generous per-assertion timeouts
 * rather than relying on this file's default.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: "http://localhost:3020",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
      testIgnore: /auth\.setup\.ts/,
    },
  ],
  webServer: {
    command: "next dev -p 3020",
    url: "http://localhost:3020",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
