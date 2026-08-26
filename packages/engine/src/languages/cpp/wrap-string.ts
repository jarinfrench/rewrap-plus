import type { WrapConfig } from '../../types/config.js';
import type { WrappableRegion } from '../../types/region.js';
import type { ReflowOptions } from '../../reflow/reflow-block.js';
import { visualIndentColumn } from '../../discovery/visual-indent-column.js';
import { dissolveString } from '../../strings/dissolve-string.js';
import { escapeQuoteCollisions } from '../../strings/escape-quote-collisions.js';
import { emitString } from '../../strings/emit-string.js';

/**
 * C++'s `LanguageAdapter.wrapString`: dissolve, normalize quote
 * collisions, and emit — the same shared `strings/` pipeline shape every
 * adapter with string support uses (`../ecmascript/adapter-support.ts`'s
 * `wrapEcmaScriptString`, `../python/wrap-string.ts`'s `wrapString`).
 *
 * `needsParens` is always `false` and `style` is always `'implicit'`, for
 * the reason `./descriptor.ts`'s own doc comment gives in full: bare
 * adjacency (`"foo" "bar"`) is C++'s *only* real concatenation syntax, and
 * it's valid wherever a single string literal already is — no enclosing
 * grouping construct to detect or insert the way Python's implicit
 * juxtaposition needs. That makes this the simpler of the two shapes
 * (Python's own `wrapString` additionally resolves `emitContext` for
 * exactly this question); C++ needs no `tree`/`emitContext` lookup at all,
 * the same simplification `wrapEcmaScriptString` already makes for its own
 * (different) reason — no second concatenation style to resolve between.
 *
 * Hanging indent follows the identical "statement's own indent plus four
 * columns" convention every other adapter's `wrapString` uses — see
 * `../python/wrap-string.ts`'s own doc comment for why this is a
 * deliberate, documented simplification rather than "aligned to the
 * opening delimiter," carried forward unchanged here since nothing about
 * C++ gives a reason to choose differently.
 */
export function wrapCppString(region: WrappableRegion, source: string, cfg: WrapConfig): string {
  const dissolved = dissolveString(region, source);
  const safeText = escapeQuoteCollisions(dissolved.text, dissolved.quoteDelimiter);

  const sourceLine = source.split('\n')[region.span.startRow] ?? '';
  const statementIndentChars = /^[ \t]*/.exec(sourceLine)?.[0].length ?? 0;
  const statementIndentColumns = visualIndentColumn(sourceLine, statementIndentChars, cfg.tabSize);
  const hangingIndentColumns = statementIndentColumns + 4;

  const reflowOptions: ReflowOptions = { mode: cfg.balancedWrapping ? 'balanced' : 'greedy' };

  return emitString(
    safeText,
    dissolved.prefix,
    dissolved.quoteDelimiter,
    region.indentColumn,
    hangingIndentColumns,
    false,
    'implicit',
    cfg.columnLimit,
    reflowOptions,
  );
}
