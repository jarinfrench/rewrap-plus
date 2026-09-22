// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
import pluginSecurity from 'eslint-plugin-security';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/out/**',
      // Compiled output of packages/vscode-extension's
      // @vscode/test-electron integration suite (tsconfig.test.json) --
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
      // Throwaway spike scripts (see docs/parsing.md) -- not part of the
      // build, not shipped, and not written against this repo's
      // TypeScript/no-Node-globals conventions.
      'docs/spikes/**',
      // Gold-fixture source files (Phase 12b's first ones written in a
      // language ESLint actually parses -- Python fixtures never
      // triggered this, being a different extension entirely). These are
      // test *data*: deliberately unused variables, and deliberately
      // whatever shape the fixture needs to exercise, not code meant to
      // satisfy this repo's own lint rules. Covers both the engine's gold
      // fixtures and the extension's @vscode/test-electron integration
      // fixtures.
      '**/test/fixtures/**/*.{js,jsx,ts,tsx}',
      '**/test/integration/fixtures/**/*.{js,jsx,ts,tsx}',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  pluginSecurity.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Both rules below are noisy-by-design for a typed codebase:
      // `detect-object-injection` flags any `obj[key]` access, including
      // ones TypeScript already constrains to known keys, and
      // `detect-non-literal-fs-filename` flags every `fs` call whose path
      // isn't a string literal, which is nearly all of them in code that
      // reads configured/discovered paths rather than hardcoded ones.
      // Neither is exploitable here in the ways the rule exists to catch;
      // the remaining `eslint-plugin-security` rules stay active because
      // this engine runs regexes and (in a few places) dynamic requires
      // against arbitrary user document content.
      'security/detect-object-injection': 'off',
      'security/detect-non-literal-fs-filename': 'off',
    },
  },
  {
    // Plain Node build scripts (not part of any package's TypeScript
    // `src`) -- need Node's CommonJS-ish globals that `js.configs.recommended`
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
    // discipline -- see README.md and CONTRIBUTING.md.
    //
    // Two rules, not one: `no-restricted-imports`'s `paths` option only
    // inspects static `import`/`export ... from` declarations (including
    // type-only ones) -- verified directly by probing it with an
    // `await import('vscode')` dynamic import, which it let through with
    // zero errors. `no-restricted-syntax` closes that gap by matching the
    // `ImportExpression` AST node itself, which covers a dynamic import
    // regardless of static/type-only-ness.
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
      'no-restricted-syntax': [
        'error',
        {
          selector: "ImportExpression[source.value='vscode']",
          message:
            'packages/engine must stay editor-agnostic. Put vscode-dependent code in packages/vscode-extension instead.',
        },
      ],
    },
  },
  prettierConfig,
);
