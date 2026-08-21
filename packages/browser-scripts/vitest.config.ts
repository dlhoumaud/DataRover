import { defineConfig } from "vitest/config";

// DOM APIs (Element, document, CSS.escape) are used directly in this package's functions — they
// only ever really run inside a real browser context (Playwright page / sandboxed iframe), but
// the unit tests exercise them here via jsdom, same as apps/web's own component tests.
export default defineConfig({
  test: {
    environment: "jsdom",
  },
});
