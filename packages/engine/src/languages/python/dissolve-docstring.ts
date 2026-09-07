import type { WrappableRegion } from '../../types/region.js';
import { sliceSpanText } from '../../discovery/slice-span.js';
import { leadingWhitespaceLength } from '../../segmentation/verbatim.js';

/**
 * Quote/prefix/indent facts a docstring's dissolve step observes, needed
 * again by `./emit-docstring.ts` to reproduce the same shape -- the
 * docstring counterpart to `../../comments/dissolve-line-comments.ts`'s
 * `spaceAfterMarker` and `../../comments/dissolve-block-comments.ts`'s
 * reliance on `descriptor.comments.block`.
 */
export interface DocstringQuoteMeta {
  /** The literal prefix as written, case preserved -- `''`, `'u'`, `'U'`. */
  readonly prefix: string;
  /** `'"""'` or `"'''"` (or, rarely, a bare `'"'`/`"'"`), as observed. */
  readonly quoteDelimiter: string;
  /**
   * `region.indentColumn` -- the visual column the opening delimiter
   * itself sits at in the file, carried through unchanged. Distinct from
   * `commonIndent` below: the two usually coincide in well-formed code,
   * but `commonIndent` is derived from the *body*'s own observed
   * indentation and can legitimately differ (inconsistently indented
   * source). `./emit-docstring.ts` needs this one specifically to budget
   * the *first* physical line, which shares the file column the
   * delimiter itself already sits at -- never `commonIndent`, which only
   * governs newly-inserted continuation lines.
   */
  readonly indentColumn: number;
  /**
   * The PEP 257 "common leading whitespace" of every line after the
   * first, stripped for reflow and restored on emit. Falls back to
   * `region.indentColumn` when the docstring has no line after the
   * first to compute it from (the overwhelmingly common single-physical-
   * line case) -- see `dissolveDocstring`'s own doc comment.
   */
  readonly commonIndent: number;
  /**
   * Whether the closing delimiter sits alone on its own line (`true`) or
   * shares its last physical line with trailing content (`false`), as
   * observed -- preserved rather than re-decided by fit, unlike
   * `../../comments/emit-block-comments.ts`'s single-line/multi-line
   * choice: PEP 257's convention is a deliberate authorial choice, not
   * something wrapping should second-guess.
   */
  readonly closingQuoteOwnLine: boolean;
}

export interface DissolvedDocstring extends DocstringQuoteMeta {
  /**
   * PEP-257-trimmed logical text, ready for a `DocDialect.segment` call
   * (`../../docs/dialect.ts`) -- deliberately *not* already turned into
   * `Block`s here, unlike `dissolveLineComments`/`dissolveBlockComments`:
   * which dialect does the segmenting is a per-docstring decision made
   * by whatever calls this (`../../wrap.ts`), not something dissolve
   * itself can know.
   */
  readonly text: string;
}

/**
 * Matches a string literal's prefix and opening quote, case preserved --
 * the same shape `../prefix.ts`'s `extractPrefix` matches, duplicated
 * rather than reused because that function lowercases the prefix for
 * `isSafeToWrap`'s comparison purposes, whereas dissolve/emit need the
 * exact original casing (`U"""..."""` must round-trip as `U`, not `u`).
 */
const PREFIX_AND_QUOTE = /^([A-Za-z]{0,3})('''|"""|'|")/;

/**
 * Dissolve a `'docstring'` `WrappableRegion`'s quote/prefix/indentation,
 * per PEP 257 ("Compute common indentation ... and strip it for reflow;
 * restore on emit. Preserve the summary-line convention: first line
 * stays on its own line, and whether the closing delimiter sits on its
 * own line is preserved as observed").
 *
 * Implements PEP 257's own canonical trimming algorithm (the same one
 * `inspect.cleandoc` uses): the first physical line is stripped of
 * *both* leading and trailing whitespace independently of every other
 * line; every line after it has the *minimum* leading-whitespace width
 * found among them (skipping blank lines) stripped, then trailing
 * whitespace removed. Whether the summary shares the opening quote's
 * physical line, or starts on the line after (quote alone on its own
 * line), falls out for free from this rather than needing separate
 * tracking: if it starts on its own line, PEP 257's own "line 0" is
 * empty, which `text` reproduces directly as a leading blank line --
 * `./emit-docstring.ts` reads that back the same way, no extra state.
 *
 * `closingQuoteOwnLine` is detected separately, from the *raw* physical
 * lines: the docstring's last body line, before the closing delimiter
 * itself is stripped off, is blank (nothing but the closing line's own
 * indentation) if and only if the delimiter sat alone on its own line.
 * That synthetic indentation-only line is excluded from `text` entirely
 * -- it isn't content, and PEP 257's own algorithm has nothing to say
 * about it -- while a *second*, genuinely authored blank line right
 * before it (content, blank line, blank-delimiter-line) is preserved.
 *
 * **Known limitation:** a docstring ending in *two* blank lines
 * immediately before a closing-own-line delimiter degrades to one on
 * re-emit. `text`'s own trailing character can't distinguish "the
 * dissolved content's last logical line is genuinely blank" from
 * "this string simply ends here" -- the same ambiguity
 * `../../segmentation/to-lines.ts` documents for exactly this reason --
 * and unlike `../../docs/dialect.ts`'s `segmentLines` (used inside every
 * `DocDialect.segment`), there's no unambiguous line array available
 * here to sidestep it with: `text` is this function's return value, not
 * an intermediate the caller could inspect first. Rare enough in
 * practice (a docstring with two full blank lines right before its
 * closing `"""`) not to be worth a richer return shape for.
 */
export function dissolveDocstring(region: WrappableRegion, source: string): DissolvedDocstring {
  const raw = sliceSpanText(source, region.span);
  const match = PREFIX_AND_QUOTE.exec(raw);
  if (!match) {
    throw new Error(
      `dissolveDocstring: region text doesn't start with a recognizable prefix/quote: ${JSON.stringify(raw.slice(0, 12))}`,
    );
  }
  const prefix = match[1]!;
  const quoteDelimiter = match[2]!;

  const afterOpen = raw.slice(prefix.length + quoteDelimiter.length);
  if (!afterOpen.endsWith(quoteDelimiter)) {
    throw new Error(
      `dissolveDocstring: region text doesn't end with its own opening delimiter '${quoteDelimiter}'`,
    );
  }
  const body = afterOpen.slice(0, afterOpen.length - quoteDelimiter.length);

  const physicalLines = body.split(/\r?\n/);
  const closingQuoteOwnLine =
    physicalLines.length > 1 && (physicalLines[physicalLines.length - 1] ?? '').trim() === '';
  const bodyLines = closingQuoteOwnLine ? physicalLines.slice(0, -1) : physicalLines;

  const first = bodyLines[0] ?? '';
  const rest = bodyLines.slice(1);
  const nonBlankRest = rest.filter((line) => line.trim() !== '');
  const commonIndent =
    nonBlankRest.length > 0
      ? Math.min(...nonBlankRest.map((line) => leadingWhitespaceLength(line)))
      : region.indentColumn;

  const text = [
    first.trim(),
    ...rest.map((line) => (line.trim() === '' ? '' : line.slice(commonIndent).replace(/[ \t]+$/, ''))),
  ].join('\n');

  return {
    text,
    prefix,
    quoteDelimiter,
    indentColumn: region.indentColumn,
    commonIndent,
    closingQuoteOwnLine,
  };
}
