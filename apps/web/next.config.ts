import type { NextConfig } from "next";

// E2E_PORT (see playwright.config.ts) lets multiple `next dev`/e2e runs share
// one checkout concurrently on different ports — but by default they'd all
// still write compiled output to the same `.next/`, corrupting each other's
// build (concurrent writers racing on the same `.next/server/app/**` files).
// Keying distDir off the same var isolates each run's build output too,
// without needing a separate variable at every call site.
const distDir = process.env.E2E_PORT ? `.next-e2e-${process.env.E2E_PORT}` : ".next";

const config: NextConfig = {
  transpilePackages: ["@mola/db", "@mola/shared"],
  experimental: { esmExternals: true },
  distDir,
};

export default config;
