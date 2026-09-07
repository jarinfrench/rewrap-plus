import type { LanguageDescriptor } from '../types/adapter.js';
import type { WrapConfig } from '../types/config.js';
import type { WrappableRegion } from '../types/region.js';
import type { ReflowOptions } from '../reflow/reflow-block.js';
import type { SplitBlocksOptions } from '../segmentation/split-blocks.js';
import { sliceSpanText } from '../discovery/slice-span.js';
import { createDialectRegistry } from '../docs/registry.js';
import { dissolveBlockCommentText } from './dissolve-block-comments.js';
import { emitBlockComments } from './emit-block-comments.js';
import { emitLineComments } from './emit-line-comments.js';

/**
 * Dialects are stateless; one shared registry for every call is safe and
 * avoids rebuilding it per region -- the `'docComment'` counterpart to
 * `../languages/python/wrap-docstring.ts`'s identical `dialectRegistry`
 * for `'docstring'` regions.
 */
const dialectRegistry = createDialectRegistry();

/**
 * Resolve which dialect governs one `'docComment'` region: `cfg.docDialect`
 * forces that dialect outright; `'auto'` detects per region (the same
 * "detect per docstring, not per file" reasoning established for
 * `'docstring'` regions applies identically here -- a codebase can easily
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
 * Dissolve, dialect-segment, and emit one `'docComment'` region --
 * generic across every adapter, unlike `wrapDocstring`/`wrapString`
 * (`../types/adapter.ts`), because a `'docComment'` region's own delimiter
 * syntax is *not* inherently language-specific: it's exactly
 * `descriptor.comments.block`'s open/close/continuation-prefix shape a
 * plain `'blockComment'` region already uses (JSDoc's `/** ... * /` is the
 * same delimiter convention as an ordinary `/** * /` comment, just
 * content a dialect additionally understands). What a `'docComment'`
 * needs beyond `dissolveBlockComments`/`emitBlockComments` is exactly one
 * thing -- segmenting through a `DocDialect` instead of the generic,
 * paragraph-only `splitBlocks` -- so this lives at engine level and is
 * called directly from `../wrap.ts`, the same way `emitWrappedBlockComment`
 * is, rather than needing its own `LanguageAdapter` hook.
 *
 * Reuses `emitBlockComments` completely unchanged for the reflow/re-
 * delimiting step: a dialect's `segment` already produces the same
 * `Block[]` shape (`fieldEntry`/`paragraph`/`blank`/...) that function
 * already knows how to lay out and reflow -- no new emit logic needed.
 */
export function wrapDocComment(
  region: WrappableRegion,
  source: string,
  descriptor: LanguageDescriptor,
  cfg: WrapConfig,
  reflowOptions: ReflowOptions = {},
): string {
  const repeatedMarker = descriptor.comments.doc?.repeatedMarker;
  if (repeatedMarker !== undefined && region.rawText.startsWith(repeatedMarker)) {
    return wrapRepeatedMarkerDocComment(region, source, descriptor, cfg, repeatedMarker, reflowOptions);
  }

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

/**
 * Strip a repeated-marker doc comment's per-line marker (e.g. Doxygen's
 * `///`), the same way `dissolveBlockCommentText` strips an open/close
 * pair -- one physical line per `region.parts` entry (grouping adjacent
 * same-indent lines into one multi-part region happens earlier, at
 * discovery time; see `../comments/group-adjacent-regions.ts`), marker
 * and at most one following space removed from each. Unlike
 * `'lineComment'` dissolve (`./dissolve-line-comments.ts`), the observed
 * per-line spacing isn't preserved on remit -- `emitBlockComments`'s own
 * continuation lines don't preserve it either (always `prefix + ' ' +
 * content`), so a repeated-marker doc comment follows that same
 * normalize-on-remit convention for consistency.
 */
function dissolveRepeatedMarkerText(region: WrappableRegion, source: string, marker: string): string {
  return region.parts
    .map((part) => {
      const raw = sliceSpanText(source, part);
      const rest = raw.startsWith(marker) ? raw.slice(marker.length) : raw;
      return rest.startsWith(' ') ? rest.slice(1) : rest;
    })
    .join('\n');
}

/**
 * Dissolve, dialect-segment, and emit a repeated-marker `'docComment'`
 * region (Doxygen's `///`) -- structurally a marker-per-line comment, not
 * an open/close-delimited block, so this reuses `emitLineComments`
 * (`./emit-line-comments.ts`) unchanged for re-delimiting rather than
 * `emitBlockComments`: a dialect's `segment` already produces the same
 * `Block[]` shape `emitLineComments` knows how to lay out and reflow,
 * the identical reuse `wrapDocComment`'s own block-shaped path gets from
 * `emitBlockComments`. Always emits `marker` followed by a space
 * (`spaceAfterMarker: true`), matching `emitBlockComments`'s own
 * continuation-line convention rather than observing each line's
 * original spacing the way `dissolveLineComments`/`emitLineComments` do
 * for an ordinary `'lineComment'` region.
 */
function wrapRepeatedMarkerDocComment(
  region: WrappableRegion,
  source: string,
  descriptor: LanguageDescriptor,
  cfg: WrapConfig,
  marker: string,
  reflowOptions: ReflowOptions,
): string {
  const text = dissolveRepeatedMarkerText(region, source, marker);

  const dialectId = resolveDialectId(descriptor, cfg, text);
  const dialect = dialectRegistry.resolve(dialectId);
  if (!dialect) {
    throw new Error(`wrapDocComment: no dialect registered for '${dialectId}'`);
  }

  const splitOptions: SplitBlocksOptions = { preserveIndentedBlocks: cfg.preserveIndentedBlocks };
  const blocks = dialect.segment(text, splitOptions);

  return emitLineComments(
    { blocks, meta: { indentColumn: region.indentColumn } },
    cfg.columnLimit,
    marker,
    true,
    reflowOptions,
  );
}
