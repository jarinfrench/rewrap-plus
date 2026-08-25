/**
 * Column limit resolution: the precedence chain a wrap command actually
 * needs (docs/implementation-plan.md, Phase 7 commit 2), as a pure
 * function over already-extracted values.
 *
 * Deliberately vscode-free — not because of the engine's hard rule (that
 * only binds `packages/engine`), but so this, the single most
 * "why did it wrap at N?" -prone piece of logic in the extension, can be
 * unit tested directly with plain fixture objects instead of needing a
 * real editor host. `./resolve-column-limit.ts` is the thin wrapper that
 * extracts these inputs from `vscode.workspace.getConfiguration` and
 * calls through to `resolveColumnLimit` below.
 *
 * Precedence, highest to lowest (plan, Phase 7 commit 2):
 * 1. `rewrapPlus.columnLimit`, including a language-scoped override.
 * 2. Language-scoped `editor.rulers` for the document's language.
 * 3. `.editorconfig` `max_line_length`.
 * 4. Global (non-language-scoped) `editor.rulers`.
 * 5. Built-in default, 80.
 */

/** `editor.rulers` entries may be a bare column number or `{ column, color }`. */
export type RulerSetting = number | { readonly column: number; readonly color?: string };

export type ColumnLimitSourceName =
  | 'rewrapPlus.columnLimit'
  | 'editor.rulers (language-scoped)'
  | '.editorconfig'
  | 'editor.rulers (global)'
  | 'default';

export interface ResolvedColumnLimit {
  readonly value: number;
  readonly source: ColumnLimitSourceName;
}

export interface ColumnLimitInputs {
  /**
   * `rewrapPlus.columnLimit`, read with the document's language scope so
   * a `"[python]": { "rewrapPlus.columnLimit": ... }` override is already
   * folded in — VSCode's own configuration resolution does that
   * transparently given a language-aware scope, so there's nothing
   * further to do here for tier 1. `null` (the setting's own default)
   * means "fall through to tier 2".
   */
  readonly rewrapPlusColumnLimit: number | null;

  /**
   * `editor.rulers`, but *only* the language-specific override layer
   * (`WorkspaceConfiguration#inspect`'s `*LanguageValue` fields) —
   * `undefined` when no `"[<language>]": { "editor.rulers": [...] }`
   * override exists at any settings scope. This is deliberately not the
   * same query as `globalRulers` below: VSCode's ordinary `get()` would
   * merge language and non-language values into one effective result,
   * which loses the distinction tier 2 vs. tier 4 depends on.
   */
  readonly languageRulers: readonly RulerSetting[] | undefined;

  /** `.editorconfig` `max_line_length` for this file, already resolved (tier 3). `undefined` if none applies, or editorconfig support is disabled. */
  readonly editorConfigMaxLineLength: number | undefined;

  /** `editor.rulers`, but only the non-language-specific layer (tier 4) — the counterpart split to `languageRulers` above. */
  readonly globalRulers: readonly RulerSetting[] | undefined;

  /** `rewrapPlus.rulerIndex` — which ruler entry to use when a tier's rulers array has more than one. */
  readonly rulerIndex: number;
}

const DEFAULT_COLUMN_LIMIT = 80;

export function resolveColumnLimit(inputs: ColumnLimitInputs): ResolvedColumnLimit {
  if (inputs.rewrapPlusColumnLimit != null) {
    return { value: inputs.rewrapPlusColumnLimit, source: 'rewrapPlus.columnLimit' };
  }

  const languageRuler = pickRuler(inputs.languageRulers, inputs.rulerIndex);
  if (languageRuler != null) {
    return { value: languageRuler, source: 'editor.rulers (language-scoped)' };
  }

  if (inputs.editorConfigMaxLineLength != null) {
    return { value: inputs.editorConfigMaxLineLength, source: '.editorconfig' };
  }

  const globalRuler = pickRuler(inputs.globalRulers, inputs.rulerIndex);
  if (globalRuler != null) {
    return { value: globalRuler, source: 'editor.rulers (global)' };
  }

  return { value: DEFAULT_COLUMN_LIMIT, source: 'default' };
}

/**
 * Pick the `rulerIndex`-th ruler's column, normalizing the `number |
 * { column, color }` shape. An out-of-range index falls back to the
 * first entry rather than treating the whole tier as absent — a
 * misconfigured `rewrapPlus.rulerIndex` shouldn't silently disable
 * ruler-based resolution the user can plainly see rulers configured for.
 */
function pickRuler(rulers: readonly RulerSetting[] | undefined, index: number): number | undefined {
  if (!rulers || rulers.length === 0) {
    return undefined;
  }
  const entry = rulers[index] ?? rulers[0];
  if (entry == null) {
    return undefined;
  }
  return typeof entry === 'number' ? entry : entry.column;
}
