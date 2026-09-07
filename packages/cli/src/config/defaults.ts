import type { ResolvedCliConfig } from './types.js';

/**
 * Built-in defaults, one tier below every file/flag source in
 * `./resolve-config.ts`'s precedence chain. Values match
 * `packages/vscode-extension/src/config/settings.ts`'s own defaults
 * exactly (`columnLimit` aside, which that file resolves through a
 * separate ruler-aware chain this module doesn't have -- see
 * `./column-limit.ts`) -- the same wrap behavior should be the default
 * whether Rewrap+ runs inside VSCode or from this CLI.
 */
export const DEFAULT_CLI_CONFIG: ResolvedCliConfig = {
  columnLimit: 80,
  tabSize: 4,
  wrapComments: true,
  wrapStrings: true,
  stringPolicy: 'prose',
  docDialect: 'auto',
  preserveIndentedBlocks: true,
  balancedWrapping: false,
  respectEditorConfig: true,
};
