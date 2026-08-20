import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// `test.globals` is off (see vite.config.ts) so testing-library's own auto-cleanup — which
// detects global test hooks — never registers itself; do it explicitly so each component test
// (e.g. JsonTreeView.test.tsx) starts from an empty document instead of accumulating every
// previous test's render.
afterEach(() => {
  cleanup();
});
