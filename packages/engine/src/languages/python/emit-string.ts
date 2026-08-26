import { atomizeWords } from '../../segmentation/atomize-words.js';
import { reflowBlock, type ReflowOptions } from '../../reflow/reflow-block.js';
import type { ConcatenationStyle } from './emit-context.js';

/**
 * Re-apply quote delimiters, prefix, and (when needed) grouping syntax to
 * dissolved-and-reflowed string content, producing the region's
 * replacement source text — the `'stringLiteral'` counterpart to
 * `./emit-docstring.ts`.
 *
 * ## Why every physical line pays its own quote overhead
 *
 * `emitDocstring` only pays its quote delimiters once, on the very first
 * and very last physical line, because a docstring is *one* string value
 * spanning real embedded newlines. Every output line here is instead a
 * *separate* string literal — Python's own implicit/`+` concatenation
 * always joins whole literals, never lines within one — so each one needs
 * its own complete `prefix + quoteDelimiter + ... + quoteDelimiter`
 * wrapper. That difference is why this function computes its available
 * width per-part rather than reusing `emitDocstring`'s first-line/rest
 * split directly, even though the underlying mechanism
 * (`ReflowOptions.firstLineReserve`) is the same one that function uses.
 *
 * ## Layout, once more than one line is needed
 *
 * The first reflowed line always shares its physical line with whatever
 * source text already precedes the region (`x = `, `foo(`, an inserted
 * `(`, ...) — mirroring `emitDocstring`'s own "first line shares the
 * prefix's budget" choice. Every later line gets a fresh line, indented to
 * `hangingIndentColumns`. When `needsParens` is set, an opening `(` is
 * glued directly onto the first line (immediately where the string used
 * to start) and a closing `)` is glued onto the last (immediately before
 * whatever source text already follows the region) — never given their
 * own line — because `wrapRegions`' edit model can only replace the
 * region's *own* span (`region.span`, never `region.span`'s neighbors), so
 * there is no way to move the character immediately before or after that
 * span onto a different line. This is a real, deliberate simplification
 * (documented rather than silent, per this project's own convention): an
 * *already*-grouped run's replacement text (`needsParens: false`) glues
 * its last line directly against the source's own pre-existing closing
 * bracket rather than giving it a dedicated line the way a human,
 * or Black, typically would.
 *
 * Every width reserves 1 column for a possible closing `)` and, for
 * `'operator'` style, 2 more for a possible trailing ` +` — uniformly,
 * even on the one line that won't actually carry either — rather than
 * trying to special-case "only the last line skips this." That costs up
 * to 3 columns of slack on non-qualifying lines; the alternative is
 * `reflowBlock` growing a "reserve extra on the last line" concept it has
 * no other user for. The same trade-off `emitDocstring` already makes and
 * documents for its own first-line budget ("always correct, occasionally
 * a few columns short of optimal").
 */
export function emitString(
  text: string,
  prefix: string,
  quoteDelimiter: string,
  indentColumn: number,
  hangingIndentColumns: number,
  needsParens: boolean,
  style: ConcatenationStyle,
  columnLimit: number,
  reflowOptions: ReflowOptions = {},
): string {
  const closingReserve = needsParens ? 1 : 0;
  const operatorReserve = style === 'operator' ? 2 : 0;
  const perLineOverhead = prefix.length + quoteDelimiter.length * 2 + closingReserve + operatorReserve;

  const contentWidth = Math.max(1, columnLimit - hangingIndentColumns - perLineOverhead);
  const firstLineOwnBudget = Math.max(
    1,
    columnLimit - indentColumn - (needsParens ? 1 : 0) - perLineOverhead,
  );
  const firstLineReserve = contentWidth - firstLineOwnBudget;

  const atoms = atomizeWords(text);
  const lines = reflowBlock({ type: 'paragraph', atoms }, contentWidth, 0, {
    ...reflowOptions,
    firstLineReserve,
  });

  if (lines.length <= 1) {
    // A single physical line never needs grouping or a concatenation
    // operator, regardless of how many parts the *original* region had —
    // re-merging back into one literal when it now fits is exactly what
    // keeps this idempotent with `dissolveString`'s own "no separator"
    // concatenation semantics.
    return prefix + quoteDelimiter + (lines[0] ?? '') + quoteDelimiter;
  }

  const physicalLines = lines.map((line, i) => {
    const leading = i === 0 ? (needsParens ? '(' : '') : ' '.repeat(hangingIndentColumns);
    const literal = prefix + quoteDelimiter + line + quoteDelimiter;
    const trailingOperator = style === 'operator' && i < lines.length - 1 ? ' +' : '';
    return leading + literal + trailingOperator;
  });

  if (needsParens) {
    physicalLines[physicalLines.length - 1] += ')';
  }
  return physicalLines.join('\n');
}
