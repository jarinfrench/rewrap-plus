import type { Block } from '../types/document.js';
import type { SplitBlocksOptions } from '../segmentation/split-blocks.js';
import { toLines } from '../segmentation/to-lines.js';
import { leadingWhitespaceLength } from '../segmentation/verbatim.js';
import { type DocDialect, type DocEmitContext, reflowDocBlocks, segmentLines } from './dialect.js';
import { groupFieldEntries, type EntryStartMatch } from './field-entries.js';

/**
 * Javadoc's flush-left tag marker: `@param`, `@return` (no trailing `s`,
 * unlike JSDoc's `@returns`), `@throws`/`@exception`, `@see`, `@since`,
 * `@author`, `@deprecated`, ... — `@`-only, unlike Doxygen's `\tag`/`@tag`
 * pair (`./doxygen.ts`). This dialect deliberately doesn't hardcode
 * Javadoc's own tag vocabulary the same way `./jsdoc.ts`/`./doxygen.ts`
 * don't hardcode theirs: `JAVADOC_TAG` matches *any* `@word` at the start
 * of a flush-left line, so `@return` vs `@returns`, or a project's own
 * custom `@apiNote`/`@implNote`-style tag, all work identically without
 * this file needing to know the difference.
 *
 * ## Inline tags need no special handling here
 *
 * Javadoc also has *inline* tags — `{@code x}`, `{@link Foo#bar}`,
 * `{@literal <T>}` — which appear mid-line, brace-delimited, not as a
 * flush-left marker `matchJavadocEntry` would ever match (nor should it:
 * `{@code x}` inside an ordinary sentence is prose content, not a
 * field-list entry). These need no dedicated handling in this dialect at
 * all: `findUnbreakableSpans`
 * (`../segmentation/unbreakable-spans.ts`) already treats *any*
 * brace-balanced `{...}` span as an atomic, never-split unit — a
 * consequence of the same `BRACE_PLACEHOLDER` pattern that exists for
 * Python format placeholders and f-string interpolations, applied
 * generically to every comment/docstring reflow, not just string
 * literals — already exercised by `./jsdoc.test.ts`'s own "keeps a
 * `{Type}` annotation intact as one atom" case, the identical mechanism a
 * `{@link ...}`/`{@code ...}` inline tag rides for free. No engine change
 * needed to support this.
 */
const JAVADOC_TAG = /^@([a-zA-Z][\w-]*)\s*(.*)$/;

function matchJavadocEntry(line: string): EntryStartMatch | null {
  if (leadingWhitespaceLength(line) !== 0) {
    return null;
  }
  const match = JAVADOC_TAG.exec(line);
  if (!match) {
    return null;
  }
  const [, tag = '', rest = ''] = match;
  return { label: `@${tag}`, rest };
}

/**
 * Javadoc-style doc comments: a summary/description, then a flat run of
 * `@param`/`@return`/`@throws`/... tags — the identical field-list shape
 * `./jsdoc.ts` and `./doxygen.ts` already handle, which this module
 * deliberately mirrors rather than reinventing (kept as its own dialect
 * id regardless — see `../types/doc-dialect.ts`'s own doc comment for
 * why). Governs a `'docComment'` region (a `/** ... * /` block comment,
 * per `../comments/wrap-doc-comment.ts`) for Java, the way `jsdocDialect`
 * does for ECMAScript-family adapters and `doxygenDialect` does for
 * C/C++-family ones.
 */
export const javadocDialect: DocDialect = {
  id: 'javadoc',

  /**
   * Confidence rises with the number of recognized tag lines found,
   * saturating quickly — the identical curve and rationale as
   * `jsdocDialect.detect`/`doxygenDialect.detect`: a single `@return` is
   * already strong, distinctive evidence.
   */
  detect(text: string): number {
    const tagCount = toLines(text).filter((line) => matchJavadocEntry(line) !== null).length;
    return tagCount === 0 ? 0 : Math.min(1, 0.5 + tagCount * 0.2);
  },

  segment(text: string, options: SplitBlocksOptions): Block[] {
    const lines = toLines(text);
    const firstTagIndex = lines.findIndex((line) => matchJavadocEntry(line) !== null);
    if (firstTagIndex === -1) {
      return segmentLines(lines, options);
    }

    const prose = lines.slice(0, firstTagIndex);
    const tagLines = lines.slice(firstTagIndex);
    return [
      ...segmentLines(prose, options),
      ...groupFieldEntries(tagLines, matchJavadocEntry, options),
    ];
  },

  emit(blocks: readonly Block[], ctx: DocEmitContext): string[] {
    return reflowDocBlocks(blocks, ctx);
  },
};
