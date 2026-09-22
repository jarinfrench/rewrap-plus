import type { WrapConfig } from '../../types/config.js';
import type { WrappableRegion } from '../../types/region.js';
import type { Tree } from '../../types/tree-sitter-types.js';
import { reflowOptionsFrom } from '../../reflow/reflow-block.js';
import { dissolveString } from '../../strings/dissolve-string.js';
import { escapeQuoteCollisions } from '../../strings/escape-quote-collisions.js';
import { emitContext } from './emit-context.js';
import { emitString } from '../../strings/emit-string.js';
import { continuationIndentColumns } from '../../strings/continuation-indent.js';
import { isSingleTripleQuotedLiteral } from './triple-quote.js';
import { wrapCodeString } from './wrap-code-string.js';

/**
 * Python's `LanguageAdapter.wrapString` implementation: dissolve
 * (`./dissolve-string.ts`), resolve emit-time context (`./emit-context.ts`),
 * normalize quote collisions (`./escape-quote-collisions.ts`), and emit
 * (`./emit-string.ts`) -- the `'stringLiteral'` counterpart to
 * `./wrap-docstring.ts`'s `wrapDocstring`, and one whole-pipeline hook for
 * the same reason that one is: a string's own concatenation/grouping
 * syntax is inherently Python-specific, so this can't be dispatched
 * generically from `../../wrap.ts` the way `'lineComment'`/`'blockComment'`
 * are.
 *
 * ## Triple-quoted regions fork to a different whole pipeline
 *
 * A single-part triple-quoted `'stringLiteral'` (`isSafeToWrap` having
 * already confirmed it's both that shape and prose-eligible -- see
 * `./adapter.ts`) is structurally incompatible with the concatenation-based
 * pipeline below: `dissolveString`/`emitString` are built around every part
 * being one physical line, which a triple-quoted body routinely isn't.
 * `wrapCodeString` (`./wrap-code-string.ts`) -- the same docstring-style
 * dissolve/segment/emit `wrapDocstring` uses -- handles that shape instead.
 * Checked first, before either dissolve function runs, since
 * `dissolveString`'s own `PREFIX_AND_QUOTE` regex would throw on a
 * triple-quote delimiter it was never meant to match.
 *
 * ## Choosing the hanging indent
 *
 * Delegated to `continuationIndentColumns`
 * (`../../strings/continuation-indent.ts`), shared with every other
 * language's string pipeline: aligned to the string's own opening quote
 * when it starts a line of its own, the statement's indent plus four
 * otherwise. Python's only contribution is `ctx.needsParens`, which that
 * function needs to keep an inserted `(` idempotent.
 */
export function wrapString(region: WrappableRegion, source: string, cfg: WrapConfig, tree: Tree): string {
  if (isSingleTripleQuotedLiteral(region, source)) {
    return wrapCodeString(region, source, cfg);
  }

  const dissolved = dissolveString(region, source);
  const ctx = emitContext(region, tree, cfg);

  const safeText = escapeQuoteCollisions(dissolved.text, dissolved.quoteDelimiter);

  const hangingIndentColumns = continuationIndentColumns(region, source, cfg, ctx.needsParens);

  const reflowOptions = reflowOptionsFrom(cfg);

  return emitString(
    safeText,
    dissolved.prefix,
    dissolved.quoteDelimiter,
    region.indentColumn,
    hangingIndentColumns,
    ctx.needsParens,
    ctx.concatenationStyle,
    cfg.columnLimit,
    reflowOptions,
  );
}
