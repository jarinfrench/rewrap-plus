/**
 * Rewrap+ engine entry point.
 *
 * Re-exports the engine's public type surface. Phase 1 defines the shared
 * vocabulary used by every later phase — spans and edits, the wrappable
 * region model, wrap configuration, the language adapter interface and
 * registry, and the logical document/block model — plus `PositionMapper`,
 * the one place that converts between tree-sitter's UTF-8 byte offsets and
 * VSCode's UTF-16 positions.
 *
 * The parser layer, region discovery, and the reflow pipeline itself are
 * added starting in Phase 2.
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
