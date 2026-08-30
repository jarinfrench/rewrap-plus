/**
 * Reads the `rewrapPlus.*` settings that aren't part of the column-limit
 * precedence chain (`./column-limit.ts`/`./resolve-column-limit.ts`
 * already own `columnLimit` and `rulerIndex`) into a plain, typed
 * object. Thin `vscode`-facing glue, like `resolve-column-limit.ts` —
 * not unit tested directly, exercised via the @vscode/test-electron
 * suite (commit 9) instead.
 *
 * Defaults here must match `contributes.configuration` in
 * `package.json` exactly — VSCode's own schema defaults are what a user
 * actually sees and gets when a setting is unset, so a mismatch would
 * make this module's fallback dead code in practice while silently
 * documenting the wrong behavior.
 */
import * as vscode from 'vscode';

export interface ExtensionSettings {
  /** Global kill switch. Checked by every command before it does anything. */
  readonly enable: boolean;
  readonly wrapComments: boolean;
  readonly wrapStrings: boolean;
  readonly stringPolicy: 'prose' | 'all' | 'off';
  readonly docDialect:
    | 'auto'
    | 'google'
    | 'numpy'
    | 'sphinx'
    | 'jsdoc'
    | 'doxygen'
    | 'javadoc'
    | 'plain';
  readonly preserveIndentedBlocks: boolean;
  readonly respectEditorConfig: boolean;
  readonly balancedWrapping: boolean;
  readonly stringWrapInclude: readonly string[];
  readonly formatOnSave: boolean;
}

export function readExtensionSettings(document: vscode.TextDocument): ExtensionSettings {
  const config = vscode.workspace.getConfiguration('rewrapPlus', document);

  return {
    enable: config.get<boolean>('enable', true),
    wrapComments: config.get<boolean>('wrapComments', true),
    // Default true: the engine's own conservative gate for string
    // wrapping is stringPolicy defaulting to 'prose' (below), not this
    // flag — 'prose' is the conservative default.
    wrapStrings: config.get<boolean>('wrapStrings', true),
    stringPolicy: config.get<'prose' | 'all' | 'off'>('stringPolicy', 'prose'),
    docDialect: config.get<
      'auto' | 'google' | 'numpy' | 'sphinx' | 'jsdoc' | 'doxygen' | 'javadoc' | 'plain'
    >('docDialect', 'auto'),
    // Default true: the guiding principle here is "bias toward
    // verbatim when uncertain" — an indented block inside a
    // comment/docstring is exactly the kind of structure a wrong guess
    // mangles (an aligned example, an ASCII diagram), so the safer
    // default leaves it alone until the user opts out.
    preserveIndentedBlocks: config.get<boolean>('preserveIndentedBlocks', true),
    respectEditorConfig: config.get<boolean>('respectEditorConfig', true),
    // Default false, matching commit 4's own note that balanced
    // (minimum-raggedness) reflow ships "behind a setting, default off".
    balancedWrapping: config.get<boolean>('balancedWrapping', false),
    stringWrapInclude: config.get<readonly string[]>('stringWrapInclude', ['**']),
    // Default false: a whole-document reflow is a much more
    // content-transformative operation than a typical code formatter, so
    // it stays opt-in even once the extension is installed and its
    // range-formatting provider is already active for "Format
    // Selection"/"Format Document" — see `../format-on-save.ts`'s own
    // doc comment for why this needs its own setting rather than reusing
    // `editor.formatOnSave` + `editor.defaultFormatter` alone.
    formatOnSave: config.get<boolean>('formatOnSave', false),
  };
}
