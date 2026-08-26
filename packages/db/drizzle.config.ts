import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: ["./src/schema.ts", "./src/auth-schema.ts"],
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://mola:mola@localhost:5433/mola",
  },
});
