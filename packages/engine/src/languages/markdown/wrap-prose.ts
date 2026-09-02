import type { WrapConfig } from '../../types/config.js';
import type { WrappableRegion } from '../../types/region.js';
import type { Tree } from '../../types/tree-sitter-types.js';
import type { ReflowOptions } from '../../reflow/reflow-block.js';
import { dissolveProse, type ProseSpec } from '../../prose/dissolve-prose.js';
import { emitProse } from '../../prose/emit-prose.js';
import { markdownContinuationPrefix } from './continuation-prefix.js';

/**
 * No hard-break patterns yet — `docs/planning/markdown-latex-plan.md`
 * §5.4's trailing-backslash/two-space/`<br>` detection is its own commit
 * (Phase C commit 11: "hard line breaks, verbatim zero-edit fixtures,
 * directives"), not this one. `ProseSpec.hardBreak` is a required field
 * (`../../prose/dissolve-prose.ts`), so this is `[]` rather than left
 * unset — every physical line boundary reflows as an ordinary join until
 * commit 11 gives some of them real hard-break markers instead.
 */
const markdownProseSpec: ProseSpec = {
  hardBreak: [],
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
