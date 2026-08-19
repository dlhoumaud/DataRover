import { defineConfig } from "vitest/config";

// Separate from vitest.config.ts (which forces `environment: "jsdom"` for component/unit tests):
// this suite drives a real, separately-launched Firefox process over the WebDriver protocol, so
// it needs the plain Node environment, a much longer timeout, and must never run as part of the
// default `pnpm test` (see e2e/workflow.e2e.test.ts's doc comment for prerequisites).
export default defineConfig({
  test: {
    environment: "node",
    include: ["e2e/**/*.e2e.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
});
