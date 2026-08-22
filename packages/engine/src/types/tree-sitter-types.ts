/**
 * Minimal structural stand-ins for the pieces of `web-tree-sitter`'s public
 * API that the Phase 1 type vocabulary needs to reference — specifically,
 * `LanguageAdapter`'s `classify` and `emitContext` hooks (see `./adapter.ts`).
 *
 * `web-tree-sitter` is not yet a dependency of this package: that lands in
 * Phase 2 ("engine: add web-tree-sitter dependency and grammar loading
 * spike"). Defining these shapes locally keeps Phase 1 free of the parser
 * dependency while still letting the adapter interface talk about nodes and
 * trees now, ahead of a parser existing to produce them.
 *
 * Phase 2 replaces this file's exports with re-exports of the real
 * `web-tree-sitter` types (`import type { SyntaxNode, Tree } from
 * 'web-tree-sitter'`); nothing outside this file should need to change
 * when that happens, since every other module imports these names from
 * here rather than from `web-tree-sitter` directly.
 */

export interface Point {
  readonly row: number;
  readonly column: number;
}

export interface SyntaxNode {
  readonly type: string;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly startPosition: Point;
  readonly endPosition: Point;
  readonly parent: SyntaxNode | null;
  readonly children: readonly SyntaxNode[];
  readonly text: string;
}

export interface Tree {
  readonly rootNode: SyntaxNode;
}
