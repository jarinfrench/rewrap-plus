import type { WrapConfig } from '../../types/config.js';
import type { WrappableRegion } from '../../types/region.js';
import type { Tree } from '../../types/tree-sitter-types.js';
import type { ReflowOptions } from '../../reflow/reflow-block.js';
import { visualIndentColumn } from '../../discovery/visual-indent-column.js';
import { dissolveString } from '../../strings/dissolve-string.js';
import { escapeQuoteCollisions } from '../../strings/escape-quote-collisions.js';
import { emitContext } from './emit-context.js';
import { emitString } from '../../strings/emit-string.js';
import { isSingleTripleQuotedLiteral } from './triple-quote.js';
import { wrapCodeString } from './wrap-code-string.js';

/**
 * Python's `LanguageAdapter.wrapString` implementation: dissolve
 * (`./dissolve-string.ts`), resolve emit-time context (`./emit-context.ts`),
 * normalize quote collisions (`./escape-quote-collisions.ts`), and emit
 * (`./emit-string.ts`) — the `'stringLiteral'` counterpart to
 * `./wrap-docstring.ts`'s `wrapDocstring`, and one whole-pipeline hook for
 * the same reason that one is: a string's own concatenation/grouping
 * syntax is inherently Python-specific, so this can't be dispatched
 * generically from `../../wrap.ts` the way `'lineComment'`/`'blockComment'`
 * are.
 *
 * ## Phase 12f: triple-quoted regions fork to a different whole pipeline
 *
 * A single-part triple-quoted `'stringLiteral'` (`isSafeToWrap` having
 * already confirmed it's both that shape and prose-eligible — see
 * `./adapter.ts`) is structurally incompatible with the concatenation-based
 * pipeline below: `dissolveString`/`emitString` are built around every part
 * being one physical line, which a triple-quoted body routinely isn't.
 * `wrapCodeString` (`./wrap-code-string.ts`) — the same docstring-style
 * dissolve/segment/emit `wrapDocstring` uses — handles that shape instead.
 * Checked first, before either dissolve function runs, since
 * `dissolveString`'s own `PREFIX_AND_QUOTE` regex would throw on a
 * triple-quote delimiter it was never meant to match.
 *
 * ## Choosing the hanging indent
 *
 * The plan calls for "continuation lines indented to the opening delimiter
 * or +4, per setting" but `WrapConfig` gained no dedicated setting for
 * this choice in Phase 7 — adding one now would be new settings-schema
 * surface `packages/vscode-extension` doesn't yet expose, for a decision
 * the plan itself frames as a style preference, not a correctness
 * requirement. This always uses the second option (`+4`, matching Black's
 * own hanging-indent convention): the *statement's own* line indentation
 * (the source line the region starts on, tab-expanded the same way
 * `discoverRegions` computes `indentColumn` itself) plus four columns —
 * deliberately not `region.indentColumn` itself, which is the *string's*
 * own column mid-line (`x = "..."`'s string starts well past the
 * statement's own indent) and would misplace every continuation line for
 * anything but a docstring-like region starting a line of its own. A known,
 * explicitly documented Phase 9 simplification, not an oversight — see
 * this module's own commit message for the "or +4" wording this
 * intentionally settles on.
 */
export function wrapString(region: WrappableRegion, source: string, cfg: WrapConfig, tree: Tree): string {
  if (isSingleTripleQuotedLiteral(region, source)) {
    return wrapCodeString(region, source, cfg);
  }

  const dissolved = dissolveString(region, source);
  const ctx = emitContext(region, tree, cfg);

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
    ctx.needsParens,
    ctx.concatenationStyle,
    cfg.columnLimit,
    reflowOptions,
  );
}
