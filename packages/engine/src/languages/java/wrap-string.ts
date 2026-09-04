import type { WrapConfig } from '../../types/config.js';
import type { WrappableRegion } from '../../types/region.js';
import { reflowOptionsFrom } from '../../reflow/reflow-block.js';
import { visualIndentColumn } from '../../discovery/visual-indent-column.js';
import { dissolveString } from '../../strings/dissolve-string.js';
import { escapeQuoteCollisions } from '../../strings/escape-quote-collisions.js';
import { emitString } from '../../strings/emit-string.js';

/**
 * Java's `LanguageAdapter.wrapString`: dissolve, normalize quote
 * collisions, and emit — the same shared `strings/` pipeline shape every
 * adapter with string support uses (`../ecmascript/adapter-support.ts`'s
 * `wrapEcmaScriptString`, `../cpp/wrap-string.ts`'s `wrapCppString`,
 * `../python/wrap-string.ts`'s `wrapString`).
 *
 * `needsParens` is always `false` and `style` is always `'operator'` —
 * the identical shape `wrapEcmaScriptString` uses, for the identical
 * reason: `"a" + "b"` is valid wherever an expression already is, with no
 * enclosing-grouping requirement the way Python's implicit juxtaposition
 * has, so this needs no `tree`/`emitContext` lookup either. Written as
 * its own local function rather than importing
 * `wrapEcmaScriptString` directly — Java isn't an ECMAScript-family
 * grammar, and keeping each adapter's own thin wrapper local (the same
 * choice `../cpp/wrap-string.ts` already made despite comparable overlap
 * with the ECMAScript-family version) keeps a language's adapter
 * self-contained without risking a change to already-hardened JS/TS code
 * for a purely cosmetic dedup.
 *
 * Hanging indent follows the identical "statement's own indent plus four
 * columns" convention every other adapter's `wrapString` uses — see
 * `../python/wrap-string.ts`'s own doc comment for why this is a
 * deliberate, documented simplification rather than "aligned to the
 * opening delimiter," carried forward unchanged here since nothing about
 * Java gives a reason to choose differently.
 */
export function wrapJavaString(region: WrappableRegion, source: string, cfg: WrapConfig): string {
  const dissolved = dissolveString(region, source);
  const safeText = escapeQuoteCollisions(dissolved.text, dissolved.quoteDelimiter);

  const sourceLine = source.split('\n')[region.span.startRow] ?? '';
  const statementIndentChars = /^[ \t]*/.exec(sourceLine)?.[0].length ?? 0;
  const statementIndentColumns = visualIndentColumn(sourceLine, statementIndentChars, cfg.tabSize);
  const hangingIndentColumns = statementIndentColumns + 4;

  const reflowOptions = reflowOptionsFrom(cfg);

  return emitString(
    safeText,
    dissolved.prefix,
    dissolved.quoteDelimiter,
    region.indentColumn,
    hangingIndentColumns,
    false,
    'operator',
    cfg.columnLimit,
    reflowOptions,
  );
}
