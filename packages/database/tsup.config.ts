import { defineConfig } from "tsup";

export default defineConfig((options) => ({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  // Only clean dist/ on a one-shot build. In `--watch` mode, cleaning on every restart races
  // with sibling packages whose own tsup/tsc process reads this package's dist/ output at
  // that exact moment (via the pnpm workspace symlink) — a transient "Cannot find module" /
  // "Could not find a declaration file" that has nothing to do with the actual source code.
  clean: !options.watch,
}));
