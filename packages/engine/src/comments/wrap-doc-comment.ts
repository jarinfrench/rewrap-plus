import type { LanguageDescriptor } from '../types/adapter.js';
import type { WrapConfig } from '../types/config.js';
import type { WrappableRegion } from '../types/region.js';
import type { ReflowOptions } from '../reflow/reflow-block.js';
import type { SplitBlocksOptions } from '../segmentation/split-blocks.js';
import { createDialectRegistry } from '../docs/registry.js';
import { dissolveBlockCommentText } from './dissolve-block-comments.js';
import { emitBlockComments } from './emit-block-comments.js';

/**
 * Dialects are stateless; one shared registry for every call is safe and
 * avoids rebuilding it per region — the `'docComment'` counterpart to
 * `../languages/python/wrap-docstring.ts`'s identical `dialectRegistry`
 * for `'docstring'` regions.
 */
const dialectRegistry = createDialectRegistry();

/**
 * Resolve which dialect governs one `'docComment'` region: `cfg.docDialect`
 * forces that dialect outright; `'auto'` detects per region (the same
 * "detect per docstring, not per file" reasoning Phase 8 established for
 * `'docstring'` regions applies identically here — a codebase can easily
 * mix a JSDoc-tagged function with a plain narrative comment) among
 * whichever dialects `descriptor.comments.doc.dialects` declares support
 * for.
 */
function resolveDialectId(descriptor: LanguageDescriptor, cfg: WrapConfig, text: string) {
  if (cfg.docDialect !== 'auto') {
    return cfg.docDialect;
  }
  const candidates = descriptor.comments.doc?.dialects ?? ['plain'];
  return dialectRegistry.detectBest(text, candidates);
}

/**
 * Dissolve, dialect-segment, and emit one `'docComment'` region —
 * generic across every adapter, unlike `wrapDocstring`/`wrapString`
 * (`../types/adapter.ts`), because a `'docComment'` region's own delimiter
 * syntax is *not* inherently language-specific: it's exactly
 * `descriptor.comments.block`'s open/close/continuation-prefix shape a
 * plain `'blockComment'` region already uses (JSDoc's `/** ... * /` is the
 * same delimiter convention as an ordinary `/** * /` comment, just
 * content a dialect additionally understands). What a `'docComment'`
 * needs beyond `dissolveBlockComments`/`emitBlockComments` is exactly one
 * thing — segmenting through a `DocDialect` instead of the generic,
 * paragraph-only `splitBlocks` — so this lives at engine level and is
 * called directly from `../wrap.ts`, the same way `emitWrappedBlockComment`
 * is, rather than needing its own `LanguageAdapter` hook.
 *
 * Reuses `emitBlockComments` completely unchanged for the reflow/re-
 * delimiting step: a dialect's `segment` already produces the same
 * `Block[]` shape (`fieldEntry`/`paragraph`/`blank`/...) that function
 * already knows how to lay out and reflow — no new emit logic needed.
 */
export function wrapDocComment(
  region: WrappableRegion,
  source: string,
  descriptor: LanguageDescriptor,
  cfg: WrapConfig,
  reflowOptions: ReflowOptions = {},
): string {
  const text = dissolveBlockCommentText(region, source, descriptor);

  const dialectId = resolveDialectId(descriptor, cfg, text);
  const dialect = dialectRegistry.resolve(dialectId);
  if (!dialect) {
    throw new Error(`wrapDocComment: no dialect registered for '${dialectId}'`);
  }

  const splitOptions: SplitBlocksOptions = { preserveIndentedBlocks: cfg.preserveIndentedBlocks };
  const blocks = dialect.segment(text, splitOptions);

  return emitBlockComments(
    { blocks, meta: { indentColumn: region.indentColumn } },
    cfg.columnLimit,
    descriptor,
    reflowOptions,
  );
}
