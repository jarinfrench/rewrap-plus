import type { LanguageAdapter } from '../../types/adapter.js';
import type { RegionKind, WrappableRegion } from '../../types/region.js';
import type { SourceSpan } from '../../types/span.js';
import type { SyntaxNode } from '../../types/tree-sitter-types.js';
import { sliceSpanText } from '../../discovery/slice-span.js';
import { groupAdjacentRegions } from '../../comments/group-adjacent-regions.js';
import { latexDescriptor } from './descriptor.js';
import { discoverLatexProse } from './discover-prose.js';
import { wrapLatexProse } from './wrap-prose.js';

/**
 * LaTeX's `classify` override: `line_comment` is the only node type
 * `latexDescriptor.queries` ever captures (commit 14's scope -- see
 * `./descriptor.ts`'s own doc comment). LaTeX has no block-comment syntax
 * of its own (`\iffalse ... \fi` produces a distinct `block_comment`
 * node, but that's a masking concern for `discoverProse` -- not a
 * `queries.comments` capture, so `classify` never sees one here).
 *
 * A **whole-line** comment (nothing but whitespace precedes it on its own
 * row) is always `'lineComment'` -- mirrors Python's identical one-line
 * `classify` (`../python/adapter.ts`) for the identical reason: one
 * comment node type, no further distinction to make.
 *
 * A **trailing** comment (real text precedes it) is excluded from
 * discovery entirely (`null`) as of commit 17's trailing-`%`-comment
 * safety fix (Sec. 6.4): `discoverLatexProse`'s masked line scan now folds a
 * trailing comment's text *into* the surrounding `'prose'` region's own
 * part for that row (through the row's own full length, not capped
 * before the comment the way commit 15 originally had it), so that
 * region -- not this generic query-driven pass -- is what carries that
 * text forward. Returning `'lineComment'` here too, as commit 15/16 did,
 * would have produced a *second*, overlapping region for the exact same
 * span `discoverRegions` (`../../discovery/discover-regions.ts`) has no
 * mechanism to reconcile with the prose region's own claim on it.
 *
 * The "whole line vs. trailing" check itself -- everything on this node's
 * own row, before its start column, is whitespace -- is read via
 * `sliceSpanText`'s cached line split rather than a fresh
 * `source.split('\n')`, since `discoverRegions` calls `classify` once per
 * captured comment node and a naive split would cost `O(file size)` per
 * comment in a large, comment-heavy file.
 */
function classify(node: SyntaxNode, source: string): RegionKind | null {
  if (node.type !== 'line_comment') {
    // Defensive: `latexDescriptor.queries` only ever captures `line_comment`.
    return null;
  }
  const beforeSpan: SourceSpan = {
    startByte: 0,
    endByte: 0,
    startRow: node.startPosition.row,
    startColumn: 0,
    endRow: node.startPosition.row,
    endColumn: node.startPosition.column,
  };
  const before = sliceSpanText(source, beforeSpan);
  return before.trim().length === 0 ? 'lineComment' : null;
}

/**
 * LaTeX's `groupRegions` override: merges consecutive same-indent
 * `'lineComment'` regions into one logical block -- the identical
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
 * `./discover-prose.ts`) is the masked line scan Sec. 6.2 describes -- LaTeX's
 * grammar has no paragraph node, so prose regions come from `source`'s own
 * physical lines rather than a query capture the way Markdown's does.
 * `wrapProse` (commit 16, `./wrap-prose.ts`) dissolves/reflows/emits each
 * discovered region through the shared `prose/` pipeline
 * (`dissolveProse`/`emitProse`), the same shape `wrapMarkdownProse` uses,
 * with LaTeX's own hard-break commands (`./hard-break.ts`) and
 * `\verb`/`\lstinline` never-split spans.
 *
 * `isSafeToWrap` is deliberately omitted: with no `queries.strings` and no
 * `'stringLiteral'` regions ever discovered from this descriptor, there is
 * nothing for it to flag unsafe -- `wrap.ts` treats an adapter with no
 * `isSafeToWrap` hook as "every region is safe" (see that module's own
 * `adapter.isSafeToWrap && ...` guard).
 */
export const latexAdapter: LanguageAdapter = {
  descriptor: latexDescriptor,
  classify,
  groupRegions,
  discoverProse: discoverLatexProse,
  wrapProse: wrapLatexProse,
};
