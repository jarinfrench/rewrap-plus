import { findUnbreakableSpans } from '../../segmentation/unbreakable-spans.js';

/**
 * Make `text` safe to re-quote uniformly with `quoteChar`, by escaping
 * every literal occurrence of `quoteChar` that isn't already escaped.
 *
 * ## Why this exists at all
 *
 * `dissolveString` (`./dissolve-string.ts`) merges every part of a
 * concatenation run into one continuous logical text, then reflow
 * redistributes that text across brand-new line breaks that don't respect
 * the original parts' boundaries. `emitString` (`./emit-string.ts`) then
 * re-quotes *every* resulting line with one representative delimiter — the
 * first part's own original quote character (`dissolveString`'s own doc
 * comment: "record original quote style"). That's safe for content that
 * originated from a part that already used *that* delimiter (Python
 * requires such content to already be properly escaped, or it wouldn't
 * have parsed), but a mixed-quote-style run like `"it's" 'she said "hi"'`
 * has a real hazard: the second part's unescaped `"` characters were only
 * ever safe because *that* part used `'` as its delimiter. Once reflow has
 * scattered the merged text across new lines all wrapped in `"`, an
 * unescaped `"` originating from that second part would prematurely
 * terminate the new literal — exactly the "silent string corruption" the
 * plan calls out as this phase's central risk.
 *
 * The fix is strictly additive and value-preserving: insert a backslash
 * before every *unescaped* occurrence of `quoteChar`. `\"` and `"` decode
 * to the identical character regardless of which delimiter encloses them,
 * so this never changes what the string evaluates to — it only changes
 * how it's spelled. The reverse (removing a *redundant* escape, e.g. a
 * `\'` inside a text that will end up `"`-delimited, where it isn't
 * strictly needed) is deliberately not attempted: leaving a harmless extra
 * escape in place is never wrong, whereas an algorithm that decides one
 * *is* removable has to be right every time to avoid corruption. Additive
 * only is the safe half of that trade-off.
 *
 * ## Never touching an unbreakable span
 *
 * `findUnbreakableSpans` (`../../segmentation/unbreakable-spans.ts`) — the
 * same utility atom segmentation already relies on to keep escape
 * sequences and f-string interpolations intact — draws exactly the
 * boundary this function also needs, for two different reasons:
 *
 * - An already-recognized escape sequence (`\'`, `\"`, `\n`, `\x41`, ...)
 *   is by definition already safe under *any* delimiter (a backslash
 *   already precedes it), so re-scanning inside one and potentially
 *   double-escaping it would be both unnecessary and wrong.
 * - A brace placeholder/f-string interpolation (`{expr}`) is *code*, not
 *   string content — `d['key']` inside an f-string interpolation must
 *   never have its `'` escaped, since that would corrupt the expression
 *   itself, not the string's value.
 *
 * Every character *outside* an unbreakable span is guaranteed to not be
 * part of any recognized multi-character escape (if it were, that escape
 * would itself have matched as a span) — meaning a lone `quoteChar` found
 * there is unambiguously bare, and a plain `split`/`join` is sufficient:
 * no backslash-parity bookkeeping is needed, because this function never
 * has to reason about a backslash it didn't just insert itself.
 */
export function escapeQuoteCollisions(text: string, quoteChar: string): string {
  const spans = findUnbreakableSpans(text);
  let result = '';
  let cursor = 0;
  for (const span of spans) {
    result += escapeBareQuote(text.slice(cursor, span.start), quoteChar);
    result += text.slice(span.start, span.end);
    cursor = span.end;
  }
  result += escapeBareQuote(text.slice(cursor), quoteChar);
  return result;
}

function escapeBareQuote(segment: string, quoteChar: string): string {
  return segment.split(quoteChar).join('\\' + quoteChar);
}
