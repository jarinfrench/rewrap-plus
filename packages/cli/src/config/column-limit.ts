import { DEFAULT_COLUMN_LIMIT, type ResolvedColumnLimit as GenericResolvedColumnLimit } from '@rewrap-plus/engine';

/**
 * Column limit resolution for the CLI: a pure function over already-
 * extracted values, the same shape as
 * `packages/vscode-extension/src/config/column-limit.ts` -- but a
 * shorter chain, since there's no live editor supplying `editor.rulers`
 * outside VSCode.
 *
 * Precedence, highest to lowest:
 * 1. `--column-limit` flag.
 * 2. `.rewraprc` `columnLimit`.
 * 3. `pyproject.toml`'s `[tool.rewrap-plus]` `column-limit`.
 * 4. `.editorconfig` `max_line_length` (only when `respectEditorConfig`
 *    -- itself resolved through the same four sources, minus this tier --
 *    is `true`).
 * 5. Built-in default (`DEFAULT_COLUMN_LIMIT`, 80).
 */
export type ColumnLimitSourceName =
  | 'flag'
  | '.rewraprc'
  | 'pyproject.toml'
  | '.editorconfig'
  | 'default';

export type ResolvedColumnLimit = GenericResolvedColumnLimit<ColumnLimitSourceName>;

export interface ColumnLimitInputs {
  readonly flagColumnLimit: number | undefined;
  readonly rewraprcColumnLimit: number | undefined;
  readonly pyprojectColumnLimit: number | undefined;
  /** Already gated by `respectEditorConfig` by the caller -- `undefined` here means either no matching section or that this tier is disabled entirely. */
  readonly editorConfigMaxLineLength: number | undefined;
}

export function resolveColumnLimit(inputs: ColumnLimitInputs): ResolvedColumnLimit {
  if (inputs.flagColumnLimit != null) {
    return { value: inputs.flagColumnLimit, source: 'flag' };
  }
  if (inputs.rewraprcColumnLimit != null) {
    return { value: inputs.rewraprcColumnLimit, source: '.rewraprc' };
  }
  if (inputs.pyprojectColumnLimit != null) {
    return { value: inputs.pyprojectColumnLimit, source: 'pyproject.toml' };
  }
  if (inputs.editorConfigMaxLineLength != null) {
    return { value: inputs.editorConfigMaxLineLength, source: '.editorconfig' };
  }
  return { value: DEFAULT_COLUMN_LIMIT, source: 'default' };
}
