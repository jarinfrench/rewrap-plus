import type { WrapConfig } from '../../types/config.js';
import type { WrappableRegion } from '../../types/region.js';
import type { SourceSpan } from '../../types/span.js';
import type { Tree } from '../../types/tree-sitter-types.js';
import type { ReflowOptions } from '../../reflow/reflow-block.js';
import { sliceSpanText } from '../../discovery/slice-span.js';
import { visualIndentColumn } from '../../discovery/visual-indent-column.js';
import { dissolveProse, type ProseSpec } from '../../prose/dissolve-prose.js';
import { emitProse } from '../../prose/emit-prose.js';
import { latexContinuationPrefix } from './continuation-prefix.js';
import { LATEX_HARD_BREAK } from './hard-break.js';

/**
 * `extraUnbreakable` (`\verb`/`\lstinline`, §4.3) is deliberately not set
 * here — the plan assigns "`\verb` unbreakability" to commit 17 alongside
 * trailing-`%` comment safety, not this commit's scope (wrapping,
 * indentation, and hard-break commands only). `ProseSpec.extraUnbreakable`
 * is optional for exactly this reason: a spec can grow it later without
 * disturbing anything this commit already ships.
 */
const latexProseSpec: ProseSpec = {
  hardBreak: LATEX_HARD_BREAK,
};

/**
 * LaTeX's `LanguageAdapter.wrapProse` implementation (`./adapter.ts`) —
 * dissolve, reflow, and emit one `'prose'` region.
 *
 * The continuation prefix is derived once per region, from the first
 * physical line's own leading whitespace (`./continuation-prefix.ts`,
 * §6.3) — read via `sliceSpanText`, not a fresh `source.split('\n')`, for
 * the identical quadratic-cost reason `wrapMarkdownProse`'s own doc
 * comment documents (`../markdown/wrap-prose.ts`): this function runs
 * once per region, in a loop over every region in the file. The slice's
 * `endColumn` is deliberately oversized (`Number.MAX_SAFE_INTEGER`)
 * rather than the region's own first-part `startColumn` — `String.slice`
 * clamps a too-large end index to the string's actual length for free,
 * and `latexContinuationPrefix`'s own leading-whitespace regex stops at
 * the first non-whitespace character regardless of how much text follows
 * it, so this sidesteps needing to know the raw line's length (or an
 * `\item`'s own marker width) up front just to bound the slice.
 *
 * `firstLineReserve`: `region.indentColumn` is the visual column
 * *continuation* lines land at (`./discover-prose.ts`'s own doc comment
 * on why — for an `\item` region this is the marker's own column, not
 * where the item's text actually starts), so `emitProse`'s single shared
 * `availableWidth = columnLimit - indentColumn` is already correctly
 * sized for continuation lines. Line 1 is narrower than that by however
 * much wider the region's real content-start column is than
 * `indentColumn` — computed here as their visual-column difference and
 * passed through as `ReflowOptions.firstLineReserve`, the same mechanism
 * `strings/emit-string.ts` already uses for its own "line 1 shares a
 * physical line with marker text that isn't part of the region" case
 * (`firstLineReserve = contentWidth - firstLineOwnBudget` there; the
 * identical shape, expressed the other way around since this function
 * already has `indentColumn` as its baseline rather than deriving it
 * fresh). For an ordinary paragraph the two columns coincide (§6.3), so
 * this is always `0` and changes nothing.
 */
export function wrapLatexProse(region: WrappableRegion, source: string, cfg: WrapConfig, _tree: Tree): string {
  const firstPart = region.parts[0]!;
  const firstLineSpan: SourceSpan = {
    startByte: 0,
    endByte: 0,
    startRow: firstPart.startRow,
    startColumn: 0,
    endRow: firstPart.startRow,
    endColumn: Number.MAX_SAFE_INTEGER,
  };
  const firstLineText = sliceSpanText(source, firstLineSpan);
  const continuationPrefix = latexContinuationPrefix(firstLineText);

  const contentColumn = visualIndentColumn(firstLineText, firstPart.startColumn, cfg.tabSize);
  const firstLineReserve = Math.max(0, contentColumn - region.indentColumn);

  const document = dissolveProse(region, source, latexProseSpec);
  const reflowOptions: ReflowOptions = {
    mode: cfg.balancedWrapping ? 'balanced' : 'greedy',
    firstLineReserve,
  };
  return emitProse(document, cfg.columnLimit, { continuationPrefix }, reflowOptions);
}
