import type { Block } from '../types/document.js';
import type { SplitBlocksOptions } from '../segmentation/split-blocks.js';
import { toLines } from '../segmentation/to-lines.js';
import { leadingWhitespaceLength } from '../segmentation/verbatim.js';
import { type DocDialect, type DocEmitContext, reflowDocBlocks, segmentLines } from './dialect.js';
import { groupFieldEntries, type EntryStartMatch } from './field-entries.js';

/**
 * Doxygen's flush-left tag marker: `\param`, `@param`, `\return`,
 * `@brief`, ... — the same field-list shape `./jsdoc.ts`'s `JSDOC_TAG`
 * already matches, generalized to accept *either* prefix character.
 * Doxygen genuinely supports both spellings of every command
 * interchangeably (unlike JSDoc, which only ever uses `@`) — this isn't
 * two dialects merged, just one dialect with two equally valid marker
 * characters for the same tag vocabulary.
 *
 * `label` preserves whichever character the source actually used (`line[0]`,
 * guaranteed to be `\` or `@` by this pattern matching at all) rather than
 * normalizing to one — a doc comment mixing `\param` and `@return` across
 * different tags is unusual but legal Doxygen, and there's no reason to
 * silently rewrite a user's chosen style on wrap. See `./jsdoc.ts`'s own
 * doc comment for why the label is just the bare tag (`\param`/`@param`),
 * not `\param name` or `\param {Type} name` — the identical "don't
 * hardcode a per-tag argument grammar" reasoning applies unchanged.
 */
const DOXYGEN_TAG = /^([\\@])([a-zA-Z][\w-]*)\s*(.*)$/;

function matchDoxygenEntry(line: string): EntryStartMatch | null {
  if (leadingWhitespaceLength(line) !== 0) {
    return null;
  }
  const match = DOXYGEN_TAG.exec(line);
  if (!match) {
    return null;
  }
  const [, marker = '@', tag = '', rest = ''] = match;
  return { label: `${marker}${tag}`, rest };
}

/**
 * Doxygen-style doc comments: a brief/detailed description, then a flat
 * run of `\param`/`@param`, `\return`/`@return`, `\throws`/`@throws`, ...
 * tags — structurally identical to JSDoc's field-list shape
 * (`./jsdoc.ts`), which this module deliberately mirrors rather than
 * reinventing, differing only in accepting the `\`-prefixed spelling
 * alongside `@`. Governs a `'docComment'` region (a `/** ... * /` block
 * comment, per `../comments/wrap-doc-comment.ts`) for C/C++-family
 * adapters, the way `jsdocDialect` does for ECMAScript-family ones.
 *
 * Deliberately does not attempt Doxygen's other comment forms
 * (`///`-repeated triple-slash lines, `//!`, `/*! ... * /`) — those are a
 * genuinely different delimiter *shape* (no single open/close pair the
 * existing `comments.block`-driven dissolve/emit machinery can express;
 * see `docs/adapters.md`'s C++ section for the full reasoning), not
 * a dialect concern. This dialect only ever receives text already
 * dissolved from a `/** ... * /`-shaped region, whichever adapter feeds it.
 */
export const doxygenDialect: DocDialect = {
  id: 'doxygen',

  /**
   * Confidence rises with the number of recognized tag lines found,
   * saturating quickly — the identical curve and rationale as
   * `jsdocDialect.detect`: a single `@return`/`\return` is already
   * strong, distinctive evidence.
   */
  detect(text: string): number {
    const tagCount = toLines(text).filter((line) => matchDoxygenEntry(line) !== null).length;
    return tagCount === 0 ? 0 : Math.min(1, 0.5 + tagCount * 0.2);
  },

  segment(text: string, options: SplitBlocksOptions): Block[] {
    const lines = toLines(text);
    const firstTagIndex = lines.findIndex((line) => matchDoxygenEntry(line) !== null);
    if (firstTagIndex === -1) {
      return segmentLines(lines, options);
    }

    const prose = lines.slice(0, firstTagIndex);
    const tagLines = lines.slice(firstTagIndex);
    return [
      ...segmentLines(prose, options),
      ...groupFieldEntries(tagLines, matchDoxygenEntry, options),
    ];
  },

  emit(blocks: readonly Block[], ctx: DocEmitContext): string[] {
    return reflowDocBlocks(blocks, ctx);
  },
};
