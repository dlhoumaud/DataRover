import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// NestJS's dependency injection relies on `emitDecoratorMetadata` (reflect-metadata's
// `design:paramtypes`) to resolve constructor parameters by type. Vitest transforms
// TypeScript via esbuild by default, which does NOT emit that metadata — every
// constructor-injected dependency (PrismaService, ProjectsService, ...) would silently end
// up `undefined` at test time even though `nest build` (which uses tsc) works fine. Routing
// the transform through SWC instead (with legacyDecorator + decoratorMetadata enabled)
// restores the metadata Nest needs, matching production behavior.
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
