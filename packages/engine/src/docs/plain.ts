import type { Block } from '../types/document.js';
import { splitBlocks, type SplitBlocksOptions } from '../segmentation/split-blocks.js';
import { type DocDialect, type DocEmitContext, reflowDocBlocks } from './dialect.js';

/**
 * The fallback dialect: paragraph/list/verbatim reflow only, no section
 * structure — `WrapConfig.docDialect: 'plain'`, and where `'auto'`
 * detection lands when nothing more specific is recognized ("ambiguous →
 * plain," per the plan). `segment` is a direct `splitBlocks` pass-through:
 * every other dialect layers section/field parsing *on top of* the same
 * paragraph/list/verbatim primitives this dialect uses bare.
 *
 * `detect` returns a small constant baseline rather than `0` so that a
 * docstring recognized by no dialect at all still has *something* to fall
 * back to in `DialectRegistry.detectBest` — every other dialect's `detect`
 * only returns above this baseline when it finds a real structural signal
 * (a Google section header, a NumPy underline, a Sphinx field marker), so
 * `'plain'` never wins over a genuine match, only over the absence of one.
 */
export const plainDialect: DocDialect = {
  id: 'plain',

  detect(): number {
    return 0.05;
  },

  segment(text: string, options: SplitBlocksOptions): Block[] {
    return splitBlocks(text, options);
  },

  emit(blocks: readonly Block[], ctx: DocEmitContext): string[] {
    return reflowDocBlocks(blocks, ctx);
  },
};
