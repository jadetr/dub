import path from "node:path";
import { defineConfig } from "vitest/config";

const APPS_WEB = path.resolve(__dirname, "../apps/web");

export default defineConfig({
  resolve: {
    alias: {
      "@/lib": path.resolve(APPS_WEB, "lib"),
      "@/": APPS_WEB + "/",
    },
  },
  test: {
    name: "integration",
    dir: "./integration",
    include: ["**/*.test.ts"],
    reporters: ["verbose"],
    globals: true,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Integration tests share live Redis + ClickHouse; run sequentially to
    // keep them deterministic.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    sequence: { concurrent: false },
  },
});
