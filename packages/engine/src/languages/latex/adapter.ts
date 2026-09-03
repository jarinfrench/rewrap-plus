import type { LanguageAdapter } from '../../types/adapter.js';
import type { RegionKind, WrappableRegion } from '../../types/region.js';
import type { SyntaxNode } from '../../types/tree-sitter-types.js';
import { groupAdjacentRegions } from '../../comments/group-adjacent-regions.js';
import { latexDescriptor } from './descriptor.js';
import { discoverLatexProse } from './discover-prose.js';

/**
 * LaTeX's `classify` override: `line_comment` is the only node type
 * `latexDescriptor.queries` ever captures (commit 14's scope — see
 * `./descriptor.ts`'s own doc comment), and it is always `'lineComment'`.
 * LaTeX has no block-comment syntax of its own (`\iffalse ... \fi`
 * produces a distinct `block_comment` node, but that's a masking concern
 * for `discoverProse`, commit 15 — not a `queries.comments` capture, so
 * `classify` never sees one here). Mirrors Python's identical one-line
 * `classify` (`../python/adapter.ts`) for the identical reason: one
 * comment node type, no further distinction to make.
 */
function classify(node: SyntaxNode): RegionKind | null {
  if (node.type === 'line_comment') {
    return 'lineComment';
  }
  // Defensive: `latexDescriptor.queries` only ever captures `line_comment`.
  return null;
}

/**
 * LaTeX's `groupRegions` override: merges consecutive same-indent
 * `'lineComment'` regions into one logical block — the identical
 * adjacency merge Python's `#` comments and C++'s `///` comments already
 * use (`../../comments/group-adjacent-regions.ts`'s `groupAdjacentRegions`,
 * generic across `RegionKind`/predicate pairs), applied here to `%`
 * comments for the same reason: a run of consecutive `%`-prefixed lines at
 * the same indent reads as one prose block, not one region per line.
 */
function groupRegions(regions: readonly WrappableRegion[]): WrappableRegion[] {
  return groupAdjacentRegions(regions, (region) => region.kind === 'lineComment');
}

/**
 * LaTeX's `LanguageAdapter`. `%` comment paragraphs flow through the
 * existing generic `'lineComment'` dissolve/emit machinery
 * (`dissolveLineComments`/`emitLineComments`), needing no LaTeX-specific
 * dissolve or emit code at all (commit 14). `discoverProse` (commit 15,
 * `./discover-prose.ts`) is the masked line scan §6.2 describes — LaTeX's
 * grammar has no paragraph node, so prose regions come from `source`'s own
 * physical lines rather than a query capture the way Markdown's does.
 * `wrapProse` (the reflow/indentation half, §6.3) is still later work —
 * `discoverProse` existing without it means every discovered `'prose'`
 * region is found but not yet wrapped, the same "discovery ships before
 * wrapping" sequencing Markdown's own commits 9/10 used.
 *
 * `isSafeToWrap` is deliberately omitted: with no `queries.strings` and no
 * `'stringLiteral'` regions ever discovered from this descriptor, there is
 * nothing for it to flag unsafe — `wrap.ts` treats an adapter with no
 * `isSafeToWrap` hook as "every region is safe" (see that module's own
 * `adapter.isSafeToWrap && ...` guard).
 */
export const latexAdapter: LanguageAdapter = {
  descriptor: latexDescriptor,
  classify,
  groupRegions,
  discoverProse: discoverLatexProse,
};
