import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@mola/db", "@mola/shared"],
  experimental: { esmExternals: true },
};

export default config;
