/**
 * The CLI's own configuration vocabulary — every `rewrapPlus.*` setting
 * that has a CLI-meaningful counterpart, expressed as plain, partial
 * data so `.rewraprc`, `pyproject.toml`'s `[tool.rewrap-plus]` table,
 * and command-line flags can each independently supply a subset of
 * fields and be merged by `./resolve-config.ts` (`undefined` means "this
 * source has no opinion," never "explicitly falsy").
 *
 * Deliberately omits every VSCode-only knob from
 * `packages/vscode-extension/src/config/settings.ts`:
 * - `enable` — the CLI's equivalent is simply not invoking it.
 * - `rulerIndex`/`editor.rulers` tiers — no `editor.rulers` concept
 *   exists outside a live editor; see `./column-limit.ts` for the CLI's
 *   own (shorter) precedence chain.
 * - `stringWrapInclude`, `formatOnSave` — both inherently editor/save-
 *   pipeline concepts with no CLI analogue.
 */
export interface PartialCliConfig {
  readonly columnLimit?: number;
  readonly tabSize?: number;
  readonly wrapComments?: boolean;
  readonly wrapStrings?: boolean;
  readonly stringPolicy?: 'prose' | 'all' | 'off';
  readonly docDialect?: 'auto' | 'google' | 'numpy' | 'sphinx' | 'jsdoc' | 'doxygen' | 'plain';
  readonly preserveIndentedBlocks?: boolean;
  readonly balancedWrapping?: boolean;
  readonly respectEditorConfig?: boolean;
}

/** Every field of `PartialCliConfig` required — what's left after `./resolve-config.ts` folds in built-in defaults. */
export type ResolvedCliConfig = Required<PartialCliConfig>;
