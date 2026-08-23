/**
 * Re-exports of the pieces of `web-tree-sitter`'s public API that the rest
 * of this package needs to reference — `LanguageAdapter`'s `classify` and
 * `emitContext` hooks (`./adapter.ts`), the parser layer (`../parser/`),
 * and everything downstream of it.
 *
 * This file used to define minimal structural stand-ins for these shapes
 * (Phase 1, "placeholder `SyntaxNode`/`Tree` types standing in for
 * `web-tree-sitter` until Phase 2"), written before `web-tree-sitter` was
 * a dependency of this package. Phase 2 adds that dependency (see
 * `docs/parsing.md`), so this file now re-exports the real types instead
 * of shadowing them — as planned, nothing outside this file needed to
 * change for the swap.
 *
 * `SyntaxNode` is kept as this package's name for what `web-tree-sitter`
 * calls `Node`, since `Node` alone reads ambiguously in a codebase that
 * also deals in document-tree types elsewhere (`Block`, `LogicalDocument`).
 * Everything in this package should import `SyntaxNode` and `Tree` from
 * here, not from `web-tree-sitter` directly, so a future rename or a
 * second parser backend only touches this one file.
 */
export type { Node as SyntaxNode, Tree, Point } from 'web-tree-sitter';
