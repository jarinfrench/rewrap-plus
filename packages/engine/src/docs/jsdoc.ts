import type { Block } from '../types/document.js';
import type { SplitBlocksOptions } from '../segmentation/split-blocks.js';
import { toLines } from '../segmentation/to-lines.js';
import { leadingWhitespaceLength } from '../segmentation/verbatim.js';
import { type DocDialect, type DocEmitContext, reflowDocBlocks, segmentLines } from './dialect.js';
import { groupFieldEntries, type EntryStartMatch } from './field-entries.js';

/**
 * JSDoc's flush-left tag marker: `@param`, `@returns`, `@throws {Error}`,
 * ... — shaped like Sphinx's `:field:` marker (`./sphinx.ts`) in every way
 * that matters to `groupFieldEntries`: a fixed marker at the start of a
 * flush-left line, everything after it on the same line is that entry's
 * first line of content.
 *
 * ## Why the label is just `@tag`, not `@tag {Type} name`
 *
 * A real JSDoc tag's own shape after the tag name is genuinely ambiguous
 * without per-tag knowledge this dialect doesn't have: `@param` takes an
 * optional `{Type}` *and* a name before its description; `@returns`/
 * `@throws` take only an optional `{Type}`; `@example`/`@deprecated` take
 * neither. Hardcoding a per-tag argument grammar to keep `{Type}`/`name`
 * out of the reflowable description would be real, separate parsing work
 * this phase doesn't need to take on — unlike Python's string-wrapping
 * risk, getting this wrong only ever produces a cosmetically different
 * wrap inside a comment, never a corrupted value, so "bias toward the
 * simpler, always-safe choice" (this project's own recurring principle)
 * settles it: `@tag` alone is the label, and `{Type}`/`name`/description
 * all flow as ordinary reflowable words after it. `findUnbreakableSpans`
 * (shared by every `atomizeWords` caller, `../segmentation/atomize-words.ts`)
 * already keeps a `{...}` type annotation from being split across a line
 * break, which covers the one case that would otherwise look genuinely
 * broken rather than merely non-optimal.
 */
const JSDOC_TAG = /^@([a-zA-Z][\w-]*)\s*(.*)$/;

function matchJsdocEntry(line: string): EntryStartMatch | null {
  if (leadingWhitespaceLength(line) !== 0) {
    return null;
  }
  const match = JSDOC_TAG.exec(line);
  if (!match) {
    return null;
  }
  const [, tag = '', rest = ''] = match;
  return { label: `@${tag}`, rest };
}

/**
 * JSDoc-style doc comments: a summary/description, then a flat run of
 * `@param`/`@returns`/`@throws`/... tags — structurally the same shape as
 * Sphinx's field list (`./sphinx.ts`), which this module deliberately
 * mirrors rather than reinventing. Governs `'docComment'` regions (a
 * `/** ... * /` block comment, per `../comments/wrap-doc-comment.ts`), not
 * `'docstring'` regions the way every other dialect here does — JSDoc is a
 * *comment* convention (JavaScript/TypeScript have no string-literal-as-
 * documentation concept), not a string one.
 */
export const jsdocDialect: DocDialect = {
  id: 'jsdoc',

  /**
   * Confidence rises with the number of recognized `@tag` lines found,
   * saturating quickly — mirrors `sphinxDialect.detect`'s own curve and
   * rationale: a single `@returns` is already strong, distinctive evidence
   * (an `@`-prefixed flush-left marker has essentially no ordinary-prose
   * false-positive risk).
   */
  detect(text: string): number {
    const tagCount = toLines(text).filter((line) => matchJsdocEntry(line) !== null).length;
    return tagCount === 0 ? 0 : Math.min(1, 0.5 + tagCount * 0.2);
  },

  segment(text: string, options: SplitBlocksOptions): Block[] {
    const lines = toLines(text);
    const firstTagIndex = lines.findIndex((line) => matchJsdocEntry(line) !== null);
    if (firstTagIndex === -1) {
      return segmentLines(lines, options);
    }

    const prose = lines.slice(0, firstTagIndex);
    const tagLines = lines.slice(firstTagIndex);
    return [
      ...segmentLines(prose, options),
      ...groupFieldEntries(tagLines, matchJsdocEntry, options),
    ];
  },

  emit(blocks: readonly Block[], ctx: DocEmitContext): string[] {
    return reflowDocBlocks(blocks, ctx);
  },
};
