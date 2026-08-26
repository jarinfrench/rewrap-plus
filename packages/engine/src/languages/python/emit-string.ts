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
 * Every width reserves 1 column for a possible closing `)`, 1 more for a
 * possible trailing split-point space (see "Preserving the space at a
 * split point" below), and, for `'operator'` style, 2 more for a possible
 * trailing ` +` — uniformly, even on the one line that won't actually
 * carry any of these — rather than trying to special-case "only the last
 * line skips this." That costs up to 4 columns of slack on non-qualifying
 * lines; the alternative is `reflowBlock` growing a "reserve extra on the
 * last line" concept it has no other user for. The same trade-off
 * `emitDocstring` already makes and documents for its own first-line
 * budget ("always correct, occasionally a few columns short of optimal").
 *
 * ## Preserving the space at a split point
 *
 * `atomizeWords`/`reflowBlock` (Phase 5) are prose-reflow machinery: a
 * line break there *replaces* the space it broke at, which is exactly
 * right for a comment or docstring paragraph, where a soft line break and
 * a space are interchangeable. They are not interchangeable here — Python
 * concatenates adjacent literals with *zero* inserted characters, so
 * splitting `"...it exceeds..."` into `"...it"` / `"exceeds..."` at the
 * word boundary would silently delete the space between "it" and
 * "exceeds" the moment they're concatenated back together. This is the
 * plan's own named central risk for this phase: "Preserve the trailing
 * space at split points — `"foo " "bar"` not `"foo" "bar"`. This is the
 * single most likely source of silent behavior change; test it hard."
 * `reflowSplitPoints` below re-derives, from the original text itself
 * (not from `Atom.glue`, which `reflowBlock`'s returned `string[]` no
 * longer carries), whether each line boundary consumed a real space, and
 * reinserts it as a trailing space on the line before the break — the
 * exact form the plan's own example uses.
 *
 * This only has to be exact because `isSafeToWrap`
 * (`./adapter.ts`) refuses any string containing a tab or a run of two or
 * more consecutive spaces before this function ever sees it — see that
 * check's own doc comment for why: `atomizeWords` collapses *any*
 * whitespace run to a single rendered space, which would silently change
 * such a string's value even on a single, never-split line. Restricting
 * to single-space word separators is what makes "was there a space at
 * this exact boundary" a well-posed, exactly-answerable question.
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
  const spaceReserve = 1;
  const perLineOverhead =
    prefix.length + quoteDelimiter.length * 2 + closingReserve + operatorReserve + spaceReserve;

  const contentWidth = Math.max(1, columnLimit - hangingIndentColumns - perLineOverhead);
  const firstLineOwnBudget = Math.max(
    1,
    columnLimit - indentColumn - (needsParens ? 1 : 0) - perLineOverhead,
  );
  const firstLineReserve = contentWidth - firstLineOwnBudget;

  const atoms = atomizeWords(text);
  const reflowed = reflowBlock({ type: 'paragraph', atoms }, contentWidth, 0, {
    ...reflowOptions,
    firstLineReserve,
  });
  const lines = reinsertSplitSpaces(text, reflowed);

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

/**
 * Given `reflowBlock`'s raw content lines (each a contiguous run of
 * `originalText`'s own characters — guaranteed by `isSafeToWrap` refusing
 * any text with irregular whitespace before this runs, per this module's
 * own doc comment), reinsert the single space each line boundary consumed
 * wherever one genuinely separated the two words on either side —
 * trailing it onto the line before the break, matching the plan's own
 * `"foo " "bar"` example.
 *
 * Walks `originalText` with a cursor rather than trusting line lengths in
 * isolation: after matching `lines[i]` starting at `cursor`, the very next
 * character in `originalText` is either a space (a real separator existed
 * — consumed by the break, so restore it) or not (the two atoms were
 * `glue: 'none'`-joined in the original, e.g. an unbreakable span
 * immediately followed by punctuation — nothing to restore, matching
 * Python's own zero-separator concatenation semantics for that case
 * without any special handling needed here).
 */
function reinsertSplitSpaces(originalText: string, lines: readonly string[]): string[] {
  let cursor = 0;
  return lines.map((line, i) => {
    cursor += line.length;
    if (i === lines.length - 1) {
      return line;
    }
    const hasSpace = originalText[cursor] === ' ';
    if (hasSpace) {
      cursor += 1;
    }
    return hasSpace ? line + ' ' : line;
  });
}
