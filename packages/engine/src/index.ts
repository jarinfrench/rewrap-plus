/**
 * Rewrap+ engine entry point.
 *
 * Re-exports the engine's public type surface. Phase 1 defines the shared
 * vocabulary used by every later phase — spans and edits, the wrappable
 * region model, wrap configuration, the language adapter interface and
 * registry, and the logical document/block model — plus `PositionMapper`,
 * the one place that converts between tree-sitter's UTF-8 byte offsets and
 * VSCode's UTF-16 positions. Phase 2 adds the parser layer:
 * `ParserManager` (lazy, cached `web-tree-sitter` grammar loading) and
 * `parseWithErrors`/`ParseResult` (error and missing-node detection built
 * on it).
 *
 * Region discovery and the reflow pipeline itself start in Phase 3.
 *
 * Hard rule: this package must never import `vscode`. See CONTRIBUTING.md.
 */
export type { SourceSpan, TextEdit } from './types/span.js';
export type { RegionKind, WrappableRegion } from './types/region.js';
export type { WrapConfig } from './types/config.js';
export type { DocDialectId } from './types/doc-dialect.js';
export type { SyntaxNode, Tree, Point } from './types/tree-sitter-types.js';
export type {
  LanguageDescriptor,
  LanguageAdapter,
  QuoteSpec,
  PrefixSpec,
  RawFormSpec,
  EscapeSpec,
  EmitContext,
} from './types/adapter.js';
export { AdapterRegistry, validateDescriptor } from './adapter-registry.js';
export type { Atom, Block, DocMeta, LogicalDocument } from './types/document.js';
export { PositionMapper } from './types/position-mapper.js';
export type { Position } from './types/position-mapper.js';
export { ParserManager } from './parser/parser-manager.js';
export type { ParserManagerOptions } from './parser/parser-manager.js';
export { parseWithErrors } from './parser/parse-result.js';
export type { ParseResult } from './parser/parse-result.js';
export { spanFromNode } from './parser/span-from-node.js';
