import path from "node:path";
import { defineConfig } from "vitest/config";

const APPS_WEB = path.resolve(__dirname, "../apps/web");

export default defineConfig({
  resolve: {
    alias: {
      "@/lib": path.resolve(APPS_WEB, "lib"),
      "@/": APPS_WEB + "/",
      "@dub/utils": path.resolve(__dirname, "__mocks__/dub-utils.ts"),
      "@maxmind/geoip2-node": path.resolve(__dirname, "__mocks__/maxmind.ts"),
    },
  },
  test: {
    name: "unit",
    dir: "./unit",
    include: ["**/*.test.ts"],
    reporters: ["verbose"],
    globals: true,
    testTimeout: 5_000,
    isolate: true,
    pool: "threads",
    poolOptions: { threads: { singleThread: false } },
  },
});
