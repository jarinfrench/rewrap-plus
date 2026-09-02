import type { WrapConfig } from '../../types/config.js';
import type { WrappableRegion } from '../../types/region.js';
import type { Tree } from '../../types/tree-sitter-types.js';
import type { ReflowOptions } from '../../reflow/reflow-block.js';
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
 */
export function wrapMarkdownProse(
  region: WrappableRegion,
  source: string,
  cfg: WrapConfig,
  _tree: Tree,
): string {
  const firstPart = region.parts[0]!;
  const firstSourceLine = source.split('\n')[firstPart.startRow] ?? '';
  const firstLinePrefix = firstSourceLine.slice(0, firstPart.startColumn);
  const continuationPrefix = markdownContinuationPrefix(firstLinePrefix);

  const document = dissolveProse(region, source, markdownProseSpec);
  const reflowOptions: ReflowOptions = { mode: cfg.balancedWrapping ? 'balanced' : 'greedy' };
  return emitProse(document, cfg.columnLimit, { continuationPrefix }, reflowOptions);
}
