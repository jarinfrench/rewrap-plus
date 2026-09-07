/**
 * Rewrap+ engine entry point.
 *
 * Re-exports the engine's public type surface, built up in layers.
 *
 * The foundation is the shared vocabulary used throughout the engine —
 * spans and edits, the wrappable region model, wrap configuration, the
 * language adapter interface and registry, and the logical
 * document/block model — plus `PositionMapper`, the one place that
 * converts between tree-sitter's UTF-8 byte offsets and VSCode's UTF-16
 * positions. On top of that sits the parser layer: `ParserManager`
 * (lazy, cached `web-tree-sitter` grammar loading) and
 * `parseWithErrors`/`ParseResult` (error and missing-node detection
 * built on it). Above that, `discoverRegions`: the generic,
 * descriptor-driven driver that turns a parsed tree into
 * `WrappableRegion`s, plus the Python adapter (`./languages/python/`)
 * that exercises it end to end.
 *
 * `splitBlocks` is the shared, language-agnostic segmenter that turns
 * dissolved region text into a `Block[]` — paragraphs and blank lines,
 * list items with hanging indents, and verbatim regions (fenced code,
 * doctests, Markdown tables, reST `::`-triggered literal blocks, and
 * indented blocks under `preserveIndentedBlocks`).
 *
 * The reflow pipeline's engine-side half is `displayWidth` (East Asian
 * Wide/Fullwidth and combining-character-aware column counting,
 * replacing an earlier `text.length` stand-in) and the
 * unbreakable-unit-aware atom segmentation it feeds (`atomizeWords`,
 * internal — escape sequences, format placeholders, f-string
 * interpolations, inline code spans, and reST roles are never split,
 * even at their own internal whitespace); and `reflowBlock`, the
 * line-breaking algorithm itself, in both a `'greedy'` first-fit mode
 * (the default) and an optional `'balanced'` minimum-raggedness mode.
 * `reflowBlock` reflows atoms only — dissolve and emit, which turn a
 * `WrappableRegion`'s raw text into blocks and back into re-escaped,
 * re-delimited source text, are separate concerns, handled respectively
 * for comments and for docstrings/strings.
 *
 * The first end-to-end wrap path is `dissolveLineComments`/
 * `emitLineComments` (`./comments/`) and `wrapRegions` (`./wrap.js`), the
 * entry point that ties parsing, discovery, dissolve, reflow, and emit
 * into `TextEdit`s.
 *
 * That path was later generalized from what shipped Python-only, and
 * proven to hold for a second adapter before other code could harden
 * around a one-adapter sample size: `wrapRegions` and the comment
 * dissolve/emit functions moved to this engine-level, adapter-driven
 * shape; `dissolveBlockComments`/`emitBlockComments` add the
 * block-comment path Python never exercised; `runAdapterConformance`
 * (`./conformance/`) is the parameterized invariant suite every adapter
 * must pass; and `javascriptAdapter` (`./languages/javascript/`) is the
 * canary that suite runs against alongside Python. See
 * `docs/adapters.md` for what that canary found.
 *
 * Hard rule: this package must never import `vscode`. See CONTRIBUTING.md.
 */
export type { SourceSpan, TextEdit } from './types/span.js';
export type { RegionKind, WrappableRegion } from './types/region.js';
export type { WrapConfig } from './types/config.js';
export { DEFAULT_COLUMN_LIMIT } from './types/column-limit-resolution.js';
export type { ResolvedColumnLimit } from './types/column-limit-resolution.js';
export type { DocDialectId } from './types/doc-dialect.js';
export type { SyntaxNode, Tree, Point } from './types/tree-sitter-types.js';
export type {
  LanguageDescriptor,
  LanguageAdapter,
  QuoteSpec,
  PrefixSpec,
  RawFormSpec,
  EscapeSpec,
  DiscoverRegionsOptions,
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
export { captureNodes, captureNodesByName } from './discovery/capture.js';
export { sliceSpanText } from './discovery/slice-span.js';
export { visualIndentColumn } from './discovery/visual-indent-column.js';
export { pythonAdapter } from './languages/python/adapter.js';
export { pythonDescriptor } from './languages/python/descriptor.js';
export { javascriptAdapter } from './languages/javascript/adapter.js';
export { javascriptDescriptor } from './languages/javascript/descriptor.js';
export { typescriptAdapter, typescriptReactAdapter } from './languages/typescript/adapter.js';
export { typescriptDescriptor, typescriptReactDescriptor } from './languages/typescript/descriptor.js';
export { cppAdapter } from './languages/cpp/adapter.js';
export { cppDescriptor } from './languages/cpp/descriptor.js';
export { javaAdapter } from './languages/java/adapter.js';
export { javaDescriptor } from './languages/java/descriptor.js';
export { markdownAdapter } from './languages/markdown/adapter.js';
export { markdownDescriptor } from './languages/markdown/descriptor.js';
export { latexAdapter } from './languages/latex/adapter.js';
export { latexDescriptor } from './languages/latex/descriptor.js';
export { tomlAdapter } from './languages/toml/adapter.js';
export { tomlDescriptor } from './languages/toml/descriptor.js';
export { shellscriptAdapter } from './languages/shellscript/adapter.js';
export { shellscriptDescriptor } from './languages/shellscript/descriptor.js';
export { dissolveLineComments } from './comments/dissolve-line-comments.js';
export type { DissolvedLineComments } from './comments/dissolve-line-comments.js';
export { emitLineComments } from './comments/emit-line-comments.js';
export { looksLikeCommentedOutCode } from './comments/looks-like-code.js';
export { dissolveProse } from './prose/dissolve-prose.js';
export type { ProseSpec } from './prose/dissolve-prose.js';
export { emitProse } from './prose/emit-prose.js';
export type { ProseLayout } from './prose/emit-prose.js';
export { wrapRegions } from './wrap.js';
export type { WrapResult, SkippedRegion, CancellationSignal } from './wrap.js';
export { runAdapterConformance } from './conformance/run-adapter-conformance.js';
export type { ConformanceFixtures } from './conformance/run-adapter-conformance.js';
export { applyTextEdits } from './apply-edits.js';
export { detectLineEnding, detectLineEndingNear, applyLineEnding } from './detect-line-ending.js';
export { splitBlocks } from './segmentation/split-blocks.js';
export type { SplitBlocksOptions } from './segmentation/split-blocks.js';
export { displayWidth } from './segmentation/display-width.js';
export { reflowBlock } from './reflow/reflow-block.js';
export type { ReflowOptions } from './reflow/reflow-block.js';
