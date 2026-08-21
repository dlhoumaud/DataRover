import { defineConfig } from "tsup";

export default defineConfig((options) => ({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  // See packages/shared/tsup.config.ts's identical comment: only clean on a one-shot build,
  // never in --watch mode (races a sibling package's own build reading this one's dist/ output).
  clean: !options.watch,
}));
