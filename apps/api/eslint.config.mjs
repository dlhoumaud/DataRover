// @ts-check
import rootConfig from "../../eslint.config.js";

export default [
  ...rootConfig,
  {
    // NestJS's dependency injection resolves constructor parameters via
    // `emitDecoratorMetadata` (reflect-metadata `design:paramtypes`), which requires the
    // injected class to still be a real VALUE import at runtime. Auto-"fixing" a
    // controller/service/module import to `import type` (as the root config's blanket rule
    // would suggest — those imports are only ever referenced in type position from ESLint's
    // point of view) silently erases the class reference and breaks DI (the property ends up
    // `undefined`), in both `nest build` and any SWC/tsc-based test run. Never apply
    // `consistent-type-imports` inside this app.
    rules: {
      "@typescript-eslint/consistent-type-imports": "off",
    },
  },
];
