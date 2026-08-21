import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// See apps/api/vitest.config.ts's identical comment: NestJS DI needs emitDecoratorMetadata,
// which esbuild (Vitest's default transform) doesn't produce — SWC does.
export default defineConfig({
  plugins: [
    swc.vite({
      jsc: {
        target: "es2022",
        parser: {
          syntax: "typescript",
          decorators: true,
        },
        transform: {
          legacyDecorator: true,
          decoratorMetadata: true,
        },
      },
    }),
  ],
});
