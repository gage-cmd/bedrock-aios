import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // eslint-config-next already registers the jsx-a11y plugin (a subset of
  // rules); this applies the full recommended rule set on top of it.
  {
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      // Label text nested inside styled spans (label > span > span) is real
      // accessible text; the default depth of 2 cannot see it.
      "jsx-a11y/label-has-associated-control": ["error", { depth: 3 }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
