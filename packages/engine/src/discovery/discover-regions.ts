import { Query } from 'web-tree-sitter';
import type { LanguageAdapter } from '../types/adapter.js';
import type { RegionKind, WrappableRegion } from '../types/region.js';
import type { SourceSpan } from '../types/span.js';
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
 * ## Concatenation-run grouping
 *
 * If `descriptor.queries.concatenations` is present, this also merges
 * adjacent string literals into multi-part regions — e.g. Python's
 * `"a" "b" "c"` or `"a" + "b" + "c"`, each as one `WrappableRegion` with
 * three `parts`, rather than three separate regions (this is what makes
 * wrapping a concatenation idempotent; Phase 10 depends on it).
 *
 * This still isn't language-specific code: it's driven entirely by a
 * capture-name convention every `queries.concatenations` is expected to
 * follow (see `LanguageAdapter.groupRegions`'s doc comment for why this
 * lives here rather than in that hook, which lacks the tree access the
 * algorithm needs):
 *
 * - A node captured as `@concat.implicit` is a container whose direct
 *   named children are themselves string-query captures — plain
 *   juxtaposition, no operator. All children are taken as the region's
 *   `parts`, in source order. If *any* named child isn't a captured
 *   string (which shouldn't happen for a well-formed descriptor, but
 *   nothing here assumes it can't), the node is left ungrouped rather
 *   than guessed at.
 * - A node captured as `@concat.operator` is a binary-operator node with
 *   `left`/`right` fields — the field-name convention `web-tree-sitter`
 *   grammars overwhelmingly use for binary expressions, not anything
 *   specific to one language. It's walked recursively: each operand is
 *   either itself a captured string leaf (base case), or another
 *   `@concat.operator` node (recurse), or neither — in which case the
 *   *entire* chain is disqualified from grouping. `"a" + name + "b"` must
 *   never become one wrappable unit just because two of its three
 *   operands are literals.
 *
 * Only outermost captures are processed (a node whose parent is also
 * captured under the same convention is skipped, since its ancestor will
 * absorb it); every string leaf that ends up part of a successful group is
 * excluded from the ordinary single-part pass below, so it isn't also
 * discovered as its own standalone region.
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

  const spanOf = (node: SyntaxNode): SourceSpan => spanFromNode(node, mapper);
  const indentColumnOf = (span: SourceSpan): number =>
    visualIndentColumn(lines[span.startRow] ?? '', span.startColumn, tabSize);

  const buildRegion = (node: SyntaxNode, kind: RegionKind): WrappableRegion => {
    const span = spanOf(node);
    return {
      kind,
      span,
      parts: [span],
      rawText: node.text,
      indentColumn: indentColumnOf(span),
      languageId,
    };
  };

  const buildGroupedRegion = (
    containerNode: SyntaxNode,
    leaves: readonly SyntaxNode[],
  ): WrappableRegion => {
    const span = spanOf(containerNode);
    return {
      // Grouping only ever applies to string-query captures — a
      // concatenation run is always `'stringLiteral'`, never
      // `'docstring'`: CPython's `__doc__` mechanism doesn't recognize a
      // concatenated string as a docstring in the first place, so
      // `classify` (Phase 3's docstring-position commit) never assigns
      // `'docstring'` to a node that could end up here.
      kind: 'stringLiteral',
      span,
      parts: leaves.map(spanOf),
      rawText: containerNode.text,
      indentColumn: indentColumnOf(span),
      languageId,
    };
  };

  const classify = (node: SyntaxNode, fallback: RegionKind): RegionKind | null =>
    adapter.classify ? adapter.classify(node, source) : fallback;

  const stringNodes = captureNodes(tree, descriptor.queries.strings, 'string');
  const stringNodeIds = new Set(stringNodes.map((n) => n.id));

  const regions: WrappableRegion[] = [];
  const groupedLeafIds = new Set<number>();

  if (descriptor.queries.concatenations) {
    const captures = captureNodesByName(tree, descriptor.queries.concatenations);
    const implicitNodes = captures.get('concat.implicit') ?? [];
    const operatorNodes = captures.get('concat.operator') ?? [];
    const implicitNodeIds = new Set(implicitNodes.map((n) => n.id));
    const operatorNodeIds = new Set(operatorNodes.map((n) => n.id));

    for (const node of implicitNodes) {
      if (node.parent && implicitNodeIds.has(node.parent.id)) {
        continue; // not outermost; its ancestor will absorb it
      }
      const leaves = node.namedChildren;
      if (leaves.length === 0 || !leaves.every((leaf) => stringNodeIds.has(leaf.id))) {
        continue; // not a pure string juxtaposition — leave parts standalone
      }
      regions.push(buildGroupedRegion(node, leaves));
      for (const leaf of leaves) {
        groupedLeafIds.add(leaf.id);
      }
    }

    for (const node of operatorNodes) {
      if (node.parent && operatorNodeIds.has(node.parent.id)) {
        continue; // not outermost
      }
      const leaves = collectOperatorChainLeaves(node, stringNodeIds, operatorNodeIds);
      if (!leaves) {
        continue; // a non-literal operand disqualifies the whole chain
      }
      regions.push(buildGroupedRegion(node, leaves));
      for (const leaf of leaves) {
        groupedLeafIds.add(leaf.id);
      }
    }
  }

  for (const node of captureNodes(tree, descriptor.queries.comments, 'comment')) {
    const kind = classify(node, 'lineComment');
    if (kind !== null) {
      regions.push(buildRegion(node, kind));
    }
  }

  for (const node of stringNodes) {
    if (groupedLeafIds.has(node.id)) {
      continue; // already covered by a multi-part region built above
    }
    const kind = classify(node, 'stringLiteral');
    if (kind !== null) {
      regions.push(buildRegion(node, kind));
    }
  }

  const grouped = adapter.groupRegions ? adapter.groupRegions(regions) : regions;
  return sortByPosition(grouped);
}

/**
 * Resolve one operand of a `@concat.operator` node to the ordered list of
 * string leaves it bottoms out to, or `null` if it doesn't bottom out to
 * string leaves at all (a non-literal operand — e.g. an identifier).
 */
function resolveOperand(
  node: SyntaxNode,
  stringNodeIds: ReadonlySet<number>,
  operatorNodeIds: ReadonlySet<number>,
): SyntaxNode[] | null {
  if (stringNodeIds.has(node.id)) {
    return [node];
  }
  if (operatorNodeIds.has(node.id)) {
    return collectOperatorChainLeaves(node, stringNodeIds, operatorNodeIds);
  }
  return null;
}

/**
 * Walk a `@concat.operator` node's `left`/`right` fields, recursing
 * through nested operator nodes, and return the ordered (left-to-right)
 * list of string leaves — or `null` if any operand along the way isn't
 * ultimately a string literal.
 */
function collectOperatorChainLeaves(
  node: SyntaxNode,
  stringNodeIds: ReadonlySet<number>,
  operatorNodeIds: ReadonlySet<number>,
): SyntaxNode[] | null {
  const left = node.childForFieldName('left');
  const right = node.childForFieldName('right');
  if (!left || !right) {
    return null;
  }

  const leftLeaves = resolveOperand(left, stringNodeIds, operatorNodeIds);
  if (!leftLeaves) {
    return null;
  }
  const rightLeaves = resolveOperand(right, stringNodeIds, operatorNodeIds);
  if (!rightLeaves) {
    return null;
  }

  return [...leftLeaves, ...rightLeaves];
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
  return captureNodesByName(tree, querySource).get(captureName) ?? [];
}

/**
 * Run `querySource` against `tree` and group the resulting nodes by
 * capture name, in the order tree-sitter reports them within each group.
 * Used directly (rather than through `captureNodes`) by the concatenation
 * handling above, which needs to distinguish `@concat.implicit` from
 * `@concat.operator` captures produced by one query.
 */
function captureNodesByName(tree: Tree, querySource: string): Map<string, SyntaxNode[]> {
  const query = new Query(tree.language, querySource);
  try {
    const byName = new Map<string, SyntaxNode[]>();
    for (const capture of query.captures(tree.rootNode)) {
      const existing = byName.get(capture.name);
      if (existing) {
        existing.push(capture.node);
      } else {
        byName.set(capture.name, [capture.node]);
      }
    }
    return byName;
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
