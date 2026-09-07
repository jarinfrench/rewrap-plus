/**
 * Coerce a caught `unknown` into a displayable string -- `format-on-save.ts`
 * and `auto-wrap.ts` both need this identical one-liner for their own
 * output-channel error lines. Kept local to this package rather than
 * shared with `packages/cli`'s own identical `describeError`
 * (`packages/cli/src/apply.ts`): the two packages are meant to stay
 * independent peers of `packages/engine` (see that file's own doc comment
 * for the fuller rationale, first written for `.editorconfig` resolution),
 * so a single line isn't worth crossing that boundary for -- but there's no
 * such boundary *within* this package, so the two in-package call sites
 * share this instead of re-inlining the same expression a second time.
 */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
