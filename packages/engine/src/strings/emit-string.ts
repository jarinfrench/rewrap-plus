import { atomizeWords } from '../segmentation/atomize-words.js';
import { reflowBlock, type ReflowOptions } from '../reflow/reflow-block.js';

/**
 * Which concatenation syntax a `'stringLiteral'` split emits with:
 * juxtaposition with no operator (Python's default, `"a" "b"`) or an
 * explicit operator between parts (Python's `+`-style, and the only style
 * JavaScript/TypeScript's descriptor declares — see
 * `../languages/ecmascript/adapter-support.ts`).
 *
 * Promoted here (from Python's own `languages/python/emit-context.ts`)
 * alongside `emitString`/`dissolveString`/`escapeQuoteCollisions`
 * — this type is `emitString`'s own vocabulary (its `style` parameter),
 * not something specific to how any one adapter's `wrapString` happens to
 * resolve it, so it belongs with the function that actually consumes it
 * rather than with one adapter's own resolution logic that produces it.
 */
export type ConcatenationStyle = 'implicit' | 'operator';

/**
 * Re-apply quote delimiters, prefix, and (when needed) grouping syntax to
 * dissolved-and-reflowed string content, producing the region's
 * replacement source text — the `'stringLiteral'` counterpart to
 * `../languages/python/emit-docstring.ts`.
 *
 * ## Promoted out of `languages/python/`
 *
 * Nothing in this function's own logic is Python-specific — every
 * Python-only concern (paren insertion, dict-key detection, prefix
 * casing) lives in `needsParens`/`prefix`'s *callers*, not here. The
 * TypeScript adapter needed this exact function (with
 * `needsParens` always `false` and `style` always `'operator'` — JS/TS
 * concatenation never requires its own grouping), the same "promote once
 * a second real consumer needs it" call already made twice before for
 * `comments/dissolve-line-comments.ts`/`emit-line-comments.ts`
 * and `./dissolve-string.ts` — see `docs/adapters.md`'s JavaScript
 * canary section.
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
 * Every line's width reserves 1 column for a possible glued-on closing
 * `)` (unconditionally — see the doc comment directly on `closingReserve`
 * below for the idempotency bug this fixes), 1 more for a possible
 * trailing split-point space (see "Preserving the space at a split
 * point" below), and, for `'operator'` style, 2 more for a possible
 * trailing ` +` — uniformly, even on lines that won't actually carry all
 * of these — rather than trying to special-case exactly which line needs
 * which. The first line additionally reserves 1 column for a glued-on
 * opening `(`, but only when `needsParens` is set — see the same doc
 * comment for why that one *is* conditional. The combined cost is up to
 * 4 columns of slack on non-qualifying lines; the alternative is
 * `reflowBlock` growing a "reserve extra on this specific line" concept
 * it has no other user for. The same trade-off `emitDocstring` already
 * makes and documents for its own first-line budget ("always correct,
 * occasionally a few
 * columns short of optimal").
 *
 * ## Preserving the space at a split point
 *
 * `atomizeWords`/`reflowBlock` are prose-reflow machinery: a
 * line break there *replaces* the space it broke at, which is exactly
 * right for a comment or docstring paragraph, where a soft line break and
 * a space are interchangeable. They are not interchangeable here — Python
 * concatenates adjacent literals with *zero* inserted characters, so
 * splitting `"...it exceeds..."` into `"...it"` / `"exceeds..."` at the
 * word boundary would silently delete the space between "it" and
 * "exceeds" the moment they're concatenated back together. Preserving the
 * trailing space at split points — `"foo " "bar"` not `"foo" "bar"` — is
 * the single most likely source of silent behavior change here, so it's
 * tested hard.
 * `reinsertSplitSpaces` below re-derives, from the original text itself
 * (not from `Atom.glue`, which `reflowBlock`'s returned `string[]` no
 * longer carries), whether each line boundary consumed a real space, and
 * reinserts it as a trailing space on the line before the break, exactly
 * as in the example above.
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
  // `closingReserve` is *unconditional* — not `needsParens ? 1 : 0` —
  // despite only `needsParens: true` ever having this function insert a
  // literal `)` itself. Found necessary, not just conservative, by a real
  // idempotency failure while generating this phase's own gold fixtures:
  // a bare assignment's first wrap (`needsParens: true`) and wrapping
  // that *same wrapped output again* (now sitting inside its own
  // freshly-inserted parens, so `needsParens: false` the second time)
  // used different `contentWidth` for the exact same physical lines —
  // because a closing `)` glued onto the last line is *never* actually
  // part of `region.span` (it belongs to the surrounding
  // `parenthesized_expression` or call's own `argument_list`, not the
  // string region itself), so it consumes a real column against every
  // line's true width whether *this* call is the one that inserted it or
  // a previous wrap already did. Reserving unconditionally makes
  // `contentWidth` depend only on `columnLimit`/`hangingIndentColumns`/
  // the text itself — never on which pass this is.
  //
  // The opening side does *not* get the same unconditional treatment,
  // and deliberately so: unlike the closing `)`, an opening `(` that
  // already exists from a previous wrap *is* reflected in `indentColumn`
  // (the string's own column shifts right by one once a `(` sits in
  // front of it) — reserving for it *again* here on top of that would
  // double-count exactly the width `indentColumn` already accounts for,
  // reintroducing the same idempotency mismatch from the other
  // direction. `needsParens` is the right, and only, signal for whether
  // *this* call is the one inserting a `(` that `indentColumn` doesn't
  // know about yet.
  const closingReserve = 1;
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
 * trailing it onto the line before the break, as in the
 * `"foo " "bar"` example above.
 *
 * Walks `originalText` with a cursor rather than trusting line lengths in
 * isolation: after matching `lines[i]` starting at `cursor`, the very next
 * character in `originalText` is either a space (a real separator existed
 * — consumed by the break, so restore it) or not (the two atoms were
 * `glue: 'none'`-joined in the original, e.g. an unbreakable span
 * immediately followed by punctuation — nothing to restore, matching
 * Python's own zero-separator concatenation semantics for that case
 * without any special handling needed here).
 *
 * ## The last line's own trailing whitespace
 *
 * Found missing while generating the JavaScript gold
 * fixtures, not anticipated by the original design: `atomizeWords`
 * (`../segmentation/atomize-words.ts`) drops *any* whitespace trailing the
 * final atom — there is no atom after it for that whitespace to be
 * "between," so the segmenter's word-scanning loop simply never visits
 * it. For a string literal ending in a real trailing space before its
 * closing quote (`"Hello, "` — entirely ordinary, e.g. as the left
 * operand of `"Hello, " + name`), that trailing space is exactly as
 * semantically real as an interior one, and dropping it silently changes
 * the string's own value — precisely the kind of silent string corruption
 * this module exists to avoid, just at the *end* of the text
 * rather than at a split point, which is why the interior-only check the
 * loop above already had didn't catch it: the loop's own `i === lines.length
 * - 1` branch returned the last line completely unexamined. Whatever
 * remains of `originalText` from `cursor` to its own end, after every
 * line has consumed its own characters, is exactly this dropped
 * whitespace (never more than a single space in practice — `isSafeToWrap`
 * already refuses any text with a tab or a run of two-or-more spaces
 * before this function ever runs — but appended verbatim regardless of
 * length, so this stays correct even called directly, outside that gate).
 */
function reinsertSplitSpaces(originalText: string, lines: readonly string[]): string[] {
  let cursor = 0;
  return lines.map((line, i) => {
    cursor += line.length;
    if (i === lines.length - 1) {
      const trailing = originalText.slice(cursor);
      return trailing.length > 0 ? line + trailing : line;
    }
    const hasSpace = originalText[cursor] === ' ';
    if (hasSpace) {
      cursor += 1;
    }
    return hasSpace ? line + ' ' : line;
  });
}
