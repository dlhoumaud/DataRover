// @ts-check
import rootConfig from "../../eslint.config.js";

export default [
  ...rootConfig,
  {
    // See apps/api/eslint.config.mjs's identical comment: NestJS DI needs injected classes to
    // stay real value imports, so `consistent-type-imports` must never "fix" them to `import type`.
    rules: {
      "@typescript-eslint/consistent-type-imports": "off",
    },
  },
];
