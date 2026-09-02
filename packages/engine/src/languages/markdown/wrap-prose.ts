import type { WrapConfig } from '../../types/config.js';
import type { WrappableRegion } from '../../types/region.js';
import type { SourceSpan } from '../../types/span.js';
import type { Tree } from '../../types/tree-sitter-types.js';
import type { ReflowOptions } from '../../reflow/reflow-block.js';
import { sliceSpanText } from '../../discovery/slice-span.js';
import { dissolveProse, type ProseSpec } from '../../prose/dissolve-prose.js';
import { emitProse } from '../../prose/emit-prose.js';
import { markdownContinuationPrefix } from './continuation-prefix.js';
import { MARKDOWN_HARD_BREAK } from './hard-break.js';

/**
 * §5.4's hard-break forms — trailing backslash (parity-aware, see
 * `./hard-break.ts`), two-or-more spaces, `<br>`/`<br/>`/`<br />`. No
 * `extraUnbreakable` — Markdown v1 has nothing beyond `atomizeWords`'
 * shared built-in set (unlike LaTeX's `\verb`/`\lstinline`).
 */
const markdownProseSpec: ProseSpec = {
  hardBreak: MARKDOWN_HARD_BREAK,
};

/**
 * Markdown's `LanguageAdapter.wrapProse` implementation
 * (`./adapter.ts`) — dissolve, reflow, and emit one `'prose'` region.
 *
 * The continuation prefix is derived once per region, from the first
 * physical line's own source text before the region's content starts
 * (`region.parts[0]`) — see `./continuation-prefix.ts` for the exact
 * derivation (§5.3). `preserveIndentedBlocks` and `docDialect` are
 * ignored (§5.5): the grammar already decided block structure, and there
 * is no documentation dialect for ordinary prose.
 *
 * Reads that prefix via `sliceSpanText`, not a fresh `source.split('\n')` —
 * this function runs once per region, and `wrapRegions` calls it in a
 * loop over every region in the file, so a fresh full-file split here
 * would cost `O(file size)` *per region*, the identical quadratic-cost
 * shape `sliceSpanText`'s own doc comment documents fixing for
 * `discoverRegions`. Confirmed as a real, not hypothetical, regression by
 * direct timing while writing this commit's own performance suite: a
 * 50,000-line all-paragraphs file (16,667 regions) took ~19s with the
 * naive split, ~1.6s once fixed to reuse `sliceSpanText`'s shared
 * per-source cache — see `../../../test/hardening/large-file-performance.test.ts`
 * and `docs/benchmarks.md` for the measured numbers this fix produced.
 */
export function wrapMarkdownProse(
  region: WrappableRegion,
  source: string,
  cfg: WrapConfig,
  _tree: Tree,
): string {
  const firstPart = region.parts[0]!;
  const prefixSpan: SourceSpan = {
    startByte: 0,
    endByte: 0,
    startRow: firstPart.startRow,
    startColumn: 0,
    endRow: firstPart.startRow,
    endColumn: firstPart.startColumn,
  };
  const firstLinePrefix = sliceSpanText(source, prefixSpan);
  const continuationPrefix = markdownContinuationPrefix(firstLinePrefix);

  const document = dissolveProse(region, source, markdownProseSpec);
  const reflowOptions: ReflowOptions = { mode: cfg.balancedWrapping ? 'balanced' : 'greedy' };
  return emitProse(document, cfg.columnLimit, { continuationPrefix }, reflowOptions);
}
