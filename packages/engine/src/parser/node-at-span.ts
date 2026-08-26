import type { SourceSpan } from '../types/span.js';
import type { SyntaxNode, Tree } from '../types/tree-sitter-types.js';

/**
 * Re-find the exact tree-sitter node a `WrappableRegion.span` (or any of
 * its `parts`) was originally built from.
 *
 * `WrappableRegion` deliberately carries no live `SyntaxNode` reference —
 * only `span`/`parts`/`rawText` (see `discoverRegions`'s doc comment on why
 * `isSafeToWrap`'s signature looks the way it does) — but Phase 9's
 * paren-insertion logic (`./emit-context.ts`) needs real tree access to
 * walk a concatenation's syntactic ancestors, and `emitContext`'s own
 * signature (`../types/adapter.ts`) hands it a `Tree`, not a node. This
 * bridges the two.
 *
 * `Node#descendantForPosition(start, end)` returns the *smallest* node
 * whose own span contains `[start, end]`. Since `span` was itself derived
 * from a real node's `startPosition`/`endPosition` (`spanFromNode`, used
 * throughout `discover-regions.ts`), passing that exact same range back in
 * returns that exact same node — not merely a containing one — as long as
 * no node type in between narrows the search away from it. `SourceSpan`'s
 * row/column fields are already UTF-16 code-unit positions, identical in
 * kind to a tree-sitter `Point` (`docs/parsing.md`, finding 3), so no
 * `PositionMapper` conversion belongs here — passing `startByte`/`endByte`
 * instead would silently be wrong for exactly the reason that finding
 * documents.
 *
 * `descendantForPosition` never actually returns `null` — probed directly,
 * an out-of-range point just clamps to `tree.rootNode` — so a `span` that
 * doesn't correspond to any real node's own extent (unreachable for a span
 * that actually came from `discoverRegions` against this same `tree`,
 * which is the only real caller) would otherwise come back as *some* node,
 * just not the one asked for, with nothing to distinguish it from a
 * legitimate match. This function closes that gap itself, rather than
 * leaving every caller to re-derive it: it re-checks the result's own
 * `startPosition`/`endPosition` against `span` and returns `null` on a
 * mismatch, so `null` here always means exactly "no node has this span,"
 * matching this codebase's established "assume the least permissive
 * answer" pattern for defensive paths that shouldn't arise from real
 * discovered output (e.g. `extractPrefix` returning `null` in `./prefix.ts`).
 */
export function nodeAtSpan(tree: Tree, span: SourceSpan): SyntaxNode | null {
  const start = { row: span.startRow, column: span.startColumn };
  const end = { row: span.endRow, column: span.endColumn };
  const node = tree.rootNode.descendantForPosition(start, end);
  if (!node) {
    return null;
  }
  const matches =
    node.startPosition.row === start.row &&
    node.startPosition.column === start.column &&
    node.endPosition.row === end.row &&
    node.endPosition.column === end.column;
  return matches ? node : null;
}
