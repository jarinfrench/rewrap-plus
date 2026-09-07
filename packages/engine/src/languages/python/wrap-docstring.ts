import type { WrapConfig } from '../../types/config.js';
import type { WrappableRegion } from '../../types/region.js';
import { reflowOptionsFrom } from '../../reflow/reflow-block.js';
import type { SplitBlocksOptions } from '../../segmentation/split-blocks.js';
import { createDialectRegistry } from '../../docs/registry.js';
import { pythonDescriptor } from './descriptor.js';
import { dissolveDocstring } from './dissolve-docstring.js';
import { emitDocstring } from './emit-docstring.js';

/**
 * Dialects are stateless; one shared registry for every call is safe and
 * avoids rebuilding it per docstring. Wired here as Python's
 * `LanguageAdapter.wrapDocstring` implementation -- see that hook's own
 * doc comment on `../../types/adapter.ts` for why this can't be
 * dispatched generically from `../../wrap.ts`.
 */
const dialectRegistry = createDialectRegistry();

/**
 * Resolve which dialect governs one docstring: `cfg.docDialect`'s named
 * dialects force that dialect outright; `'auto'` detects per docstring --
 * mixed conventions in one codebase are common, and a file-level guess
 * would be wrong somewhere -- among whichever dialects `pythonDescriptor`
 * declares support for (`comments.doc.dialects` -- every dialect this
 * package ships, today).
 */
function resolveDialectId(cfg: WrapConfig, text: string) {
  if (cfg.docDialect !== 'auto') {
    return cfg.docDialect;
  }
  const candidates = pythonDescriptor.comments.doc?.dialects ?? ['plain'];
  return dialectRegistry.detectBest(text, candidates);
}

/**
 * Python's `LanguageAdapter.wrapDocstring` implementation: dissolve
 * (`./dissolve-docstring.ts`), resolve and run the governing dialect's
 * `segment` (`../../docs/dialect.ts`), then emit (`./emit-docstring.ts`).
 */
export function wrapDocstring(region: WrappableRegion, source: string, cfg: WrapConfig): string {
  const dissolved = dissolveDocstring(region, source);

  const dialectId = resolveDialectId(cfg, dissolved.text);
  // `pythonDescriptor` always declares every dialect this package ships
  // (see its own `comments.doc.dialects`), so `resolve` only ever
  // returns `undefined` here for a forced `cfg.docDialect` naming a
  // dialect nothing registered -- a configuration error upstream (the
  // extension's own settings schema constrains this enum), not a data
  // condition worth a silent fallback for.
  const dialect = dialectRegistry.resolve(dialectId);
  if (!dialect) {
    throw new Error(`wrapDocstring: no dialect registered for '${dialectId}'`);
  }

  const splitOptions: SplitBlocksOptions = { preserveIndentedBlocks: cfg.preserveIndentedBlocks };
  const blocks = dialect.segment(dissolved.text, splitOptions);

  const reflowOptions = reflowOptionsFrom(cfg);
  return emitDocstring(blocks, dissolved, cfg.columnLimit, reflowOptions);
}
