/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";

export default defineConfig({
  // The monorepo centralizes its env config in a single root .env (see .env.example) rather
  // than one per app — point Vite there instead of the default (this package's own directory).
  envDir: fileURLToPath(new URL("../..", import.meta.url)),
  plugins: [react()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    // Listen on every interface, not just localhost — harmless for plain `pnpm dev` on the host,
    // but required for the dev server to be reachable at all from outside a Docker container
    // (docker-compose.dev.yml's "web" service).
    host: true,
  },
  preview: {
    port: Number(process.env.WEB_PORT ?? 5173),
    host: true,
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test/setup.ts"],
    // e2e/**/*.e2e.test.ts is a separate suite (see vitest.e2e.config.ts / `pnpm test:e2e`) —
    // it drives a real Firefox process and must never run as part of the default `pnpm test`.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
