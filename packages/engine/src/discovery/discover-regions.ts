import type { DiscoverRegionsOptions, LanguageAdapter } from '../types/adapter.js';
import type { RegionKind, WrappableRegion } from '../types/region.js';
import type { SourceSpan } from '../types/span.js';
import type { SyntaxNode, Tree } from '../types/tree-sitter-types.js';
import { PositionMapper } from '../types/position-mapper.js';
import { spanFromNode } from '../parser/span-from-node.js';
import { normalizeRawText } from './normalize-raw-text.js';
import { visualIndentColumn } from './visual-indent-column.js';
import { captureNodes, captureNodesByName } from './capture.js';

/**
 * Find every wrappable region in `tree`, driven entirely by `adapter`'s
 * descriptor and hooks.
 *
 * This function is deliberately language-agnostic: it runs
 * `descriptor.queries.comments` and `descriptor.queries.strings` against
 * the tree (skipping either pass entirely when the corresponding query is
 * absent -- a prose-only language like Markdown declares neither), classifies
 * each captured node via `adapter.classify` (falling back to the obvious
 * default -- `'lineComment'` / `'stringLiteral'` -- for an adapter that
 * doesn't override it), and hands the resulting flat region list to
 * `adapter.groupRegions` for any language-specific merging. Nothing here
 * references Python, or any other language, by name -- that's what keeps
 * this reusable once a second adapter exists (the JavaScript canary
 * adapter is what actually proves that; this is the code the canary
 * exercises).
 *
 * `adapter.discoverProse?.(tree, source, languageId, options)` runs
 * *in addition to* the query-driven passes above, appending every
 * `'prose'` region it returns before grouping and the final sort -- see
 * `../types/adapter.ts`'s own doc comment on `discoverProse` for why this
 * is a whole-pipeline hook rather than descriptor query data alone.
 *
 * `adapter.classify` returning `null` for a captured node excludes it
 * from discovery entirely (per its own doc comment on
 * `../types/adapter.ts`) -- note this is *not* the same as the hook being
 * absent, so the fallback only applies when `adapter.classify` itself is
 * undefined, not when it's defined and happens to return `null`.
 *
 * ## Concatenation-run grouping
 *
 * If `descriptor.queries.concatenations` is present, this also merges
 * adjacent string literals into multi-part regions -- e.g. Python's
 * `"a" "b" "c"` or `"a" + "b" + "c"`, each as one `WrappableRegion` with
 * three `parts`, rather than three separate regions (this is what makes
 * wrapping a concatenation idempotent, which reflow logic depends on).
 *
 * This still isn't language-specific code: it's driven entirely by a
 * capture-name convention every `queries.concatenations` is expected to
 * follow (see `LanguageAdapter.groupRegions`'s doc comment for why this
 * lives here rather than in that hook, which lacks the tree access the
 * algorithm needs):
 *
 * - A node captured as `@concat.implicit` is a container whose direct
 *   named children are themselves string-query captures -- plain
 *   juxtaposition, no operator. All children are taken as the region's
 *   `parts`, in source order. If *any* named child isn't a captured
 *   string (which shouldn't happen for a well-formed descriptor, but
 *   nothing here assumes it can't), the node is left ungrouped rather
 *   than guessed at.
 * - A node captured as `@concat.operator` is a binary-operator node with
 *   `left`/`right` fields -- the field-name convention `web-tree-sitter`
 *   grammars overwhelmingly use for binary expressions, not anything
 *   specific to one language. It's walked recursively: each operand is
 *   either itself a captured string leaf (base case), or another
 *   `@concat.operator` node (recurse), or neither -- in which case the
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
  const mapper = options.mapper ?? new PositionMapper(source);
  const lines = options.sourceLines ?? source.split('\n');
  const { descriptor } = adapter;

  const spanOf = (node: SyntaxNode): SourceSpan => trimTrailingCR(spanFromNode(node, mapper), node);
  const indentColumnOf = (span: SourceSpan): number =>
    visualIndentColumn(lines[span.startRow] ?? '', span.startColumn, tabSize);

  const buildRegion = (node: SyntaxNode, kind: RegionKind): WrappableRegion => {
    const span = spanOf(node);
    return {
      kind,
      span,
      parts: [span],
      rawText: normalizeRawText(node.text),
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
      // Grouping only ever applies to string-query captures -- a
      // concatenation run is always `'stringLiteral'`, never
      // `'docstring'`: CPython's `__doc__` mechanism doesn't recognize a
      // concatenated string as a docstring in the first place, so
      // `classify`'s docstring-position logic never assigns `'docstring'`
      // to a node that could end up here.
      kind: 'stringLiteral',
      span,
      parts: leaves.map(spanOf),
      rawText: normalizeRawText(containerNode.text),
      indentColumn: indentColumnOf(span),
      languageId,
    };
  };

  const classify = (node: SyntaxNode, fallback: RegionKind): RegionKind | null =>
    adapter.classify ? adapter.classify(node, source) : fallback;

  const stringNodes = descriptor.queries.strings
    ? captureNodes(tree, descriptor.queries.strings, 'string')
    : [];
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
        continue; // not a pure string juxtaposition -- leave parts standalone
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

  if (descriptor.queries.comments) {
    for (const node of captureNodes(tree, descriptor.queries.comments, 'comment')) {
      const kind = classify(node, 'lineComment');
      if (kind !== null) {
        regions.push(buildRegion(node, kind));
      }
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

  regions.push(...(adapter.discoverProse?.(tree, source, languageId, options) ?? []));

  const grouped = adapter.groupRegions ? adapter.groupRegions(regions) : regions;
  return sortByPosition(grouped);
}

/**
 * Walk a `@concat.operator` node's `left`/`right` fields, through nested
 * operator nodes, and return the ordered (left-to-right) list of string
 * leaves -- or `null` if any operand along the way isn't ultimately a
 * string literal.
 *
 * Iterative (explicit stack), not recursive -- a long chain of
 * `+`-concatenated string literals (real Python `tree-sitter-python`
 * happily parses, and exactly the shape this grouping algorithm exists
 * to handle) parses left-associatively, producing an `binary_operator`
 * tree whose depth scales with operand count. A recursive walk blew the
 * actual JS call stack on such input (`RangeError: Maximum call stack
 * size exceeded` on a ~20k-operand chain, caught by dedicated
 * pathological-input hardening) well before "deeply nested concat" as a
 * named risk was ever exercised for real.
 * The standard "push right then left" iterative in-order traversal below
 * has no such limit (bounded only by heap, not call-stack depth) and
 * handles right-side nesting (explicit parenthesization) the same way,
 * so no separate `resolveOperand` helper is needed.
 */
function collectOperatorChainLeaves(
  root: SyntaxNode,
  stringNodeIds: ReadonlySet<number>,
  operatorNodeIds: ReadonlySet<number>,
): SyntaxNode[] | null {
  const leaves: SyntaxNode[] = [];
  const stack: SyntaxNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (stringNodeIds.has(node.id)) {
      leaves.push(node);
      continue;
    }
    if (operatorNodeIds.has(node.id)) {
      const left = node.childForFieldName('left');
      const right = node.childForFieldName('right');
      if (!left || !right) {
        return null;
      }
      stack.push(right, left); // left popped (processed) first
      continue;
    }
    return null; // a non-literal operand disqualifies the whole chain
  }
  return leaves;
}

/**
 * Shrink `span` by one column/byte if `node.text` ends in a lone
 * trailing `\r` -- confirmed by direct grammar probing
 * (`docs/adapters.md`, "CRLF handling") to happen for Python `comment`
 * nodes on a CRLF-terminated line: the node's own extent runs to
 * end-of-line, which sits *before* the `\n` (not part of the node) but
 * *after* the `\r` (which is). No other node shape in this grammar ends
 * this way -- a string literal's span always terminates at its own
 * closing delimiter, never at end-of-line -- so this only ever fires for
 * the case it's meant to fix.
 *
 * Without this, `WrappableRegion.span`/`.parts` would include that `\r`
 * as real, editable content: `sliceSpanText` would return it as part of
 * a comment line's text, and any `TextEdit` built from the span would
 * consume the file's own line-ending byte along with it -- exactly the
 * kind of contamination `rawText`'s own normalization
 * (`./normalize-raw-text.ts`) sidesteps by never being treated as an
 * editing source in the first place. A `WrappableRegion`'s `span`
 * *is* used as an editing source (`wrapRegions` slices and replaces it
 * directly), so it needs the real fix, not just a display-layer one.
 *
 * `\r` is a single ASCII character -- one UTF-16 code unit, one UTF-8
 * byte -- so adjusting `endColumn`/`endByte` by exactly `1` is exact
 * without re-deriving anything through `PositionMapper`. `endRow` never
 * changes: a lone trailing `\r` never advances a row on its own (only
 * `\n` does, and `\n` is never part of `node.text` here).
 */
function trimTrailingCR(span: SourceSpan, node: SyntaxNode): SourceSpan {
  if (!node.text.endsWith('\r')) {
    return span;
  }
  return { ...span, endColumn: span.endColumn - 1, endByte: span.endByte - 1 };
}

function sortByPosition(regions: readonly WrappableRegion[]): WrappableRegion[] {
  return [...regions].sort((a, b) => {
    if (a.span.startRow !== b.span.startRow) {
      return a.span.startRow - b.span.startRow;
    }
    return a.span.startColumn - b.span.startColumn;
  });
}
