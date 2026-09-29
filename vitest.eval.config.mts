import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Live evaluation against the real model and search: run by hand with `pnpm eval`, never in CI,
// because every scenario is billed. Files end in `.eval.ts` so `pnpm test` never picks them up.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["tests/eval/**/*.eval.ts"],
    env: loadEnv("development", process.cwd(), ""),
    testTimeout: 600_000,
    fileParallelism: false,
  },
});
