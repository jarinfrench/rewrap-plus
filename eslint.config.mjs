// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/out/**', '**/*.vsix', '**/coverage/**', '**/node_modules/**'],
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
