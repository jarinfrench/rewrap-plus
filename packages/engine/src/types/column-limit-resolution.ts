/**
 * The narrow, shared half of column-limit resolution — a convention both
 * `packages/cli/src/config/column-limit.ts` and
 * `packages/vscode-extension/src/config/column-limit.ts` independently
 * reinvented (the same `DEFAULT_COLUMN_LIMIT = 80` fallback and the same
 * `{ value, source }` result shape) even though their actual precedence
 * tiers are genuinely different config surfaces (flags/`.rewraprc`/
 * `pyproject.toml`/`.editorconfig` vs. `rewrapPlus.columnLimit`/
 * `editor.rulers`/`.editorconfig`) that must stay independently readable —
 * see each of those files' own doc comments for why the *resolvers*
 * themselves are not merged here.
 *
 * Lives here, in the engine, only because `packages/engine` is the one
 * module both of those otherwise-independent peer packages already
 * import — not because column-limit *resolution* is itself an engine
 * pipeline concern (the engine only ever consumes the already-resolved
 * `WrapConfig.columnLimit: number`). This is the same "promote once a
 * second real consumer needs it" reasoning `docs/adapters.md` already
 * uses elsewhere, applied to a two-line constant and a two-field shape
 * rather than to pipeline logic.
 */

/**
 * Column limit assumed when no configured source supplies one — the
 * bottom tier of both `resolveColumnLimit` implementations.
 */
export const DEFAULT_COLUMN_LIMIT = 80;

/**
 * The `{ value, source }` shape a caller's own column-limit resolver
 * returns, generic over that caller's own tier-name union
 * (`ColumnLimitSourceName` in both `packages/cli/src/config/column-limit.ts`
 * and `packages/vscode-extension/src/config/column-limit.ts` — two
 * different unions, since the two packages' precedence tiers are
 * genuinely different data, not the same tiers under a different name).
 */
export interface ResolvedColumnLimit<TSource extends string> {
  readonly value: number;
  readonly source: TSource;
}
