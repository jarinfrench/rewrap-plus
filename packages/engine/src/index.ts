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
 * on it). Phase 3 adds `discoverRegions`: the generic, descriptor-driven
 * driver that turns a parsed tree into `WrappableRegion`s, plus the
 * Python adapter (`./languages/python/`) that exercises it end to end.
 *
 * Phase 4 adds `splitBlocks`: the shared, language-agnostic segmenter that
 * turns dissolved region text into a `Block[]` — paragraphs and blank
 * lines, list items with hanging indents, and verbatim regions (fenced
 * code, doctests, Markdown tables, reST `::`-triggered literal blocks,
 * and indented blocks under `preserveIndentedBlocks`).
 *
 * Phase 5 completes the reflow pipeline's engine-side half:
 * `displayWidth` (East Asian Wide/Fullwidth and combining-character-aware
 * column counting, replacing the earlier phases' `text.length` stand-in)
 * and the unbreakable-unit-aware atom segmentation it feeds
 * (`atomizeWords`, internal — escape sequences, format placeholders,
 * f-string interpolations, inline code spans, and reST roles are never
 * split, even at their own internal whitespace); and `reflowBlock`, the
 * line-breaking algorithm itself, in both a `'greedy'` first-fit mode
 * (the default) and an optional `'balanced'` minimum-raggedness mode.
 * `reflowBlock` reflows atoms only — dissolve and emit, which turn a
 * `WrappableRegion`'s raw text into blocks and back into re-escaped,
 * re-delimited source text, are Phase 6 (comments) and Phase 8/9
 * (docstrings and strings) respectively.
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
export { discoverRegions } from './discovery/discover-regions.js';
export type { DiscoverRegionsOptions } from './discovery/discover-regions.js';
export { sliceSpanText } from './discovery/slice-span.js';
export { visualIndentColumn } from './discovery/visual-indent-column.js';
export { pythonAdapter } from './languages/python/adapter.js';
export { pythonDescriptor } from './languages/python/descriptor.js';
export { dissolveLineComments } from './languages/python/line-comment-dissolve.js';
export type { DissolvedLineComments } from './languages/python/line-comment-dissolve.js';
export { emitLineComments } from './languages/python/line-comment-emit.js';
export { wrapRegions } from './languages/python/wrap.js';
export type { WrapResult, SkippedRegion } from './languages/python/wrap.js';
export { applyTextEdits } from './apply-edits.js';
export { splitBlocks } from './segmentation/split-blocks.js';
export type { SplitBlocksOptions } from './segmentation/split-blocks.js';
export { displayWidth } from './segmentation/display-width.js';
export { reflowBlock } from './reflow/reflow-block.js';
export type { ReflowOptions } from './reflow/reflow-block.js';
