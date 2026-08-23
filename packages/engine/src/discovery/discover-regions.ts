import { Query } from 'web-tree-sitter';
import type { LanguageAdapter } from '../types/adapter.js';
import type { RegionKind, WrappableRegion } from '../types/region.js';
import type { SyntaxNode, Tree } from '../types/tree-sitter-types.js';
import { PositionMapper } from '../types/position-mapper.js';
import { spanFromNode } from '../parser/span-from-node.js';
import { visualIndentColumn } from './visual-indent-column.js';

export interface DiscoverRegionsOptions {
  /**
   * Tab width used to compute `WrappableRegion.indentColumn`. Defaults to
   * 4 — see `./visual-indent-column.ts` for why a real `WrapConfig.tabSize`
   * isn't threaded through yet.
   */
  readonly tabSize?: number;
}

/**
 * Find every wrappable region in `tree`, driven entirely by `adapter`'s
 * descriptor and hooks.
 *
 * This function is deliberately language-agnostic: it runs
 * `descriptor.queries.comments` and `descriptor.queries.strings` against
 * the tree, classifies each captured node via `adapter.classify` (falling
 * back to the obvious default — `'lineComment'` / `'stringLiteral'` — for
 * an adapter that doesn't override it), and hands the resulting flat
 * region list to `adapter.groupRegions` for any language-specific
 * merging. Nothing here references Python, or any other language, by
 * name — that's what keeps this reusable once a second adapter exists
 * (Phase 6b's canary is what actually proves that; this is the code the
 * canary will exercise).
 *
 * `adapter.classify` returning `null` for a captured node excludes it
 * from discovery entirely (per its own doc comment on
 * `../types/adapter.ts`) — note this is *not* the same as the hook being
 * absent, so the fallback only applies when `adapter.classify` itself is
 * undefined, not when it's defined and happens to return `null`.
 *
 * Concatenation-run grouping — merging several adjacent string literals
 * into one multi-part region — is *not* handled here yet. That needs
 * `descriptor.queries.concatenations`, which no adapter provides as of
 * this commit; see the doc comment this function grows once Python's
 * adapter needs it ("python: group adjacent string literals into
 * concatenation runs").
 */
export function discoverRegions(
  adapter: LanguageAdapter,
  tree: Tree,
  source: string,
  languageId: string,
  options: DiscoverRegionsOptions = {},
): WrappableRegion[] {
  const tabSize = options.tabSize ?? 4;
  const mapper = new PositionMapper(source);
  const lines = source.split('\n');
  const { descriptor } = adapter;

  const buildRegion = (node: SyntaxNode, kind: RegionKind): WrappableRegion => {
    const span = spanFromNode(node, mapper);
    return {
      kind,
      span,
      parts: [span],
      rawText: node.text,
      indentColumn: visualIndentColumn(lines[span.startRow] ?? '', span.startColumn, tabSize),
      languageId,
    };
  };

  const classify = (node: SyntaxNode, fallback: RegionKind): RegionKind | null =>
    adapter.classify ? adapter.classify(node, source) : fallback;

  const regions: WrappableRegion[] = [];

  for (const node of captureNodes(tree, descriptor.queries.comments, 'comment')) {
    const kind = classify(node, 'lineComment');
    if (kind !== null) {
      regions.push(buildRegion(node, kind));
    }
  }

  for (const node of captureNodes(tree, descriptor.queries.strings, 'string')) {
    const kind = classify(node, 'stringLiteral');
    if (kind !== null) {
      regions.push(buildRegion(node, kind));
    }
  }

  const grouped = adapter.groupRegions ? adapter.groupRegions(regions) : regions;
  return sortByPosition(grouped);
}

/**
 * Run `querySource` against `tree` and return the nodes captured under
 * `captureName`, in the order tree-sitter reports them.
 *
 * `descriptor.queries.comments`/`.strings` are expected to use exactly
 * one capture name each (`@comment`, `@string` by convention — see every
 * shipped descriptor) — this filters by name defensively rather than
 * assuming a query has no other captures, so a future descriptor with
 * predicates or helper captures alongside the main one doesn't silently
 * pull in the wrong nodes.
 */
function captureNodes(tree: Tree, querySource: string, captureName: string): SyntaxNode[] {
  const query = new Query(tree.language, querySource);
  try {
    return query
      .captures(tree.rootNode)
      .filter((capture) => capture.name === captureName)
      .map((capture) => capture.node);
  } finally {
    query.delete();
  }
}

function sortByPosition(regions: readonly WrappableRegion[]): WrappableRegion[] {
  return [...regions].sort((a, b) => {
    if (a.span.startRow !== b.span.startRow) {
      return a.span.startRow - b.span.startRow;
    }
    return a.span.startColumn - b.span.startColumn;
  });
}
