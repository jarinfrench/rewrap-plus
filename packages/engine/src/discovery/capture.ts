import { Query } from 'web-tree-sitter';
import type { SyntaxNode, Tree } from '../types/tree-sitter-types.js';

/**
 * Run `querySource` against `tree` and group the resulting nodes by
 * capture name, in the order tree-sitter reports them within each group.
 *
 * Extracted out of `./discover-regions.ts` (which still uses it for
 * `queries.comments`/`.strings`/`.concatenations`) so a `discoverProse`
 * hook -- Markdown's, in particular, whose discovery is a straightforward
 * `queries.prose` capture -- can run its own query without
 * re-implementing this, or importing from `discover-regions.ts` and
 * risking a cycle back through
 * `../types/adapter.ts` (which `discoverProse`'s own signature lives on).
 */
export function captureNodesByName(tree: Tree, querySource: string): Map<string, SyntaxNode[]> {
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

/**
 * Run `querySource` against `tree` and return the nodes captured under
 * `captureName`, in the order tree-sitter reports them.
 *
 * A single-capture-name convenience over `captureNodesByName` -- most
 * queries (`queries.comments`/`.strings`/`.prose`) use exactly one
 * capture name each (`@comment`, `@string`, `@prose` by convention) and
 * don't need the full multi-name map.
 */
export function captureNodes(tree: Tree, querySource: string, captureName: string): SyntaxNode[] {
  return captureNodesByName(tree, querySource).get(captureName) ?? [];
}
