// @ts-check
import eslint from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },
  {
    plugins: { boundaries },
    settings: {
      'import/resolver': {
        typescript: true,
      },
      'boundaries/elements': [
        { type: 'module', pattern: 'src/modules/*/**' },
        { type: 'core', pattern: 'src/core/*/**' },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        2,
        {
          default: 'disallow',
          policies: [
            {
              from: { element: { types: 'module' } },
              allow: { to: { element: { types: 'core' } } },
            },
            // The 'module' type matches src/modules/*/** for every module,
            // not just one -- so this also permits importing a *different*
            // module's files, not only your own. There's no capture-group
            // support wired up here yet to narrow it to "same module only".
            // Needed so a module's own files (e.g. a controller under its
            // api/ folder) can import its own service.
            {
              from: { element: { types: 'module' } },
              allow: { to: { element: { types: 'module' } } },
            },
            {
              from: { element: { types: 'core' } },
              allow: { to: { element: { types: 'core' } } },
            },
          ],
        },
      ],
    },
  },
);
