// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/out/**',
      // Compiled output of packages/vscode-extension's
      // @vscode/test-electron integration suite (tsconfig.test.json) —
      // plain CommonJS `require`/`exports` and Mocha's `describe`/`it`
      // globals, neither of which this config's TypeScript/no-Node-
      // globals rules are meant to apply to; the *source* under
      // test/integration/ is linted normally.
      '**/out-test/**',
      // @vscode/test-electron's downloaded VSCode instance + extension
      // sandbox, created by running the integration suite locally.
      '**/.vscode-test/**',
      '**/*.vsix',
      '**/coverage/**',
      '**/node_modules/**',
      // Throwaway spike scripts (see docs/parsing.md) — not part of the
      // build, not shipped, and not written against this repo's
      // TypeScript/no-Node-globals conventions.
      'docs/spikes/**',
      // Gold-fixture source files (Phase 12b's first ones written in a
      // language ESLint actually parses — Python fixtures never
      // triggered this, being a different extension entirely). These are
      // test *data*: deliberately unused variables, and deliberately
      // whatever shape the fixture needs to exercise, not code meant to
      // satisfy this repo's own lint rules.
      '**/test/fixtures/**/*.{js,jsx,ts,tsx}',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Plain Node build scripts (not part of any package's TypeScript
    // `src`) — need Node's CommonJS-ish globals that `js.configs.recommended`
    // doesn't assume, unlike every other file in this config.
    files: ['**/scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
      },
    },
  },
  {
    // Hard rule (decision of record): packages/engine must never import
    // `vscode`. This mechanically enforces it rather than relying on
    // discipline — see README.md and CONTRIBUTING.md.
    files: ['packages/engine/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'vscode',
              message:
                'packages/engine must stay editor-agnostic. Put vscode-dependent code in packages/vscode-extension instead.',
            },
          ],
        },
      ],
    },
  },
  prettierConfig,
);
