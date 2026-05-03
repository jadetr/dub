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
    name: "e2e",
    dir: "./e2e",
    include: ["**/*.test.ts"],
    reporters: ["verbose"],
    globals: true,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
