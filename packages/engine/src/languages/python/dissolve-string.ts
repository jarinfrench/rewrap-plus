import type { WrappableRegion } from '../../types/region.js';
import { sliceSpanText } from '../../discovery/slice-span.js';

/**
 * One part's own prefix/quote/body, recovered from its exact source text.
 */
interface StringPartInfo {
  readonly prefix: string;
  readonly quoteDelimiter: string;
  readonly body: string;
}

/**
 * Quote/prefix facts a string's dissolve step observes, needed again by
 * `./emit-string.ts` to re-quote the reflowed result — the `stringLiteral`
 * counterpart to `./dissolve-docstring.ts`'s `DocstringQuoteMeta`.
 */
export interface DissolvedString {
  /**
   * Every part's body, concatenated with no separator — exactly Python's
   * own implicit-concatenation semantics (`"a" "b"` evaluates to the same
   * value as a single `"ab"` literal, never `"a b"`). Still carrying every
   * escape sequence exactly as written; see this module's own "no real
   * unescaping" note below for why.
   */
  readonly text: string;
  /** The representative prefix (original case) reused for every emitted part. */
  readonly prefix: string;
  /** The representative quote delimiter (`'` or `"`) reused for every emitted part. */
  readonly quoteDelimiter: string;
}

/**
 * Single-character-quote prefix+delimiter matcher — deliberately narrower
 * than `../prefix.ts`'s `PREFIX_AND_QUOTE` (which also matches `'''`/`"""`):
 * a triple-quoted `'stringLiteral'` region never reaches this function,
 * since `isSafeToWrap` (`./adapter.ts`) marks one unsafe before dissolve is
 * ever called (see that function's own doc comment on why triple-quoted
 * *ordinary* strings are Phase 9's deliberate scope limit, matching the
 * plan's own Phase 12f framing: "Triple-quoted non-docstring code strings
 * (the deferred case)"). A part that somehow doesn't match this narrower
 * pattern is a genuine contract violation from whatever built the region,
 * so this throws rather than guessing — the same posture
 * `dissolveDocstring` takes for its own prefix/quote mismatch.
 */
const PREFIX_AND_QUOTE = /^([A-Za-z]{0,3})('|")/;

function parsePart(raw: string): StringPartInfo {
  const match = PREFIX_AND_QUOTE.exec(raw);
  if (!match) {
    throw new Error(
      `dissolveString: part text doesn't start with a recognizable prefix/quote: ${JSON.stringify(raw.slice(0, 12))}`,
    );
  }
  const prefix = match[1]!;
  const quoteDelimiter = match[2]!;
  if (!raw.endsWith(quoteDelimiter) || raw.length < prefix.length + quoteDelimiter.length * 2) {
    throw new Error(
      `dissolveString: part text doesn't end with its own opening delimiter '${quoteDelimiter}': ${JSON.stringify(raw)}`,
    );
  }
  const body = raw.slice(prefix.length + quoteDelimiter.length, raw.length - quoteDelimiter.length);
  return { prefix, quoteDelimiter, body };
}

/**
 * Dissolve a `'stringLiteral'` `WrappableRegion` — an ordinary string or a
 * concatenation run of them — into its merged logical text plus the
 * quote/prefix metadata `./emit-string.ts` needs to re-quote it.
 *
 * ## Deliberately no real unescaping
 *
 * The plan's own pipeline vocabulary calls dissolve's job "strip syntax,
 * unescape, recover logical text" — but decoding an escape sequence into
 * its real character here would actively work against Phase 5's own
 * segmentation design, not cooperate with it. `atomizeWords`
 * (`../../segmentation/atomize-words.ts`) already treats every recognized
 * escape sequence (`\n`, `\t`, `\x41`, ...) as one opaque, unsplittable
 * atom — exactly so reflow can move it as a unit without knowing what it
 * means. Decoding `\t` to a real tab character before segmentation would
 * make `atomizeWords`'s own whitespace scanner treat it as a word
 * *separator* instead, silently discarding the escape entirely on
 * re-emission — a real value change, not merely a formatting one, and
 * exactly the "silent string corruption" the plan calls its central risk
 * for this phase. Leaving every escape exactly as written and letting the
 * existing unbreakable-span machinery carry it through untouched is both
 * simpler and strictly safer: nothing here ever has to *re*-encode an
 * escape on emit, because nothing decoded it in the first place.
 *
 * What "recover logical text" reduces to, then, is exactly what strips
 * *syntax* rather than *content*: dropping each part's prefix and quote
 * delimiters and concatenating the raw bodies with no separator (Python's
 * own implicit-concatenation semantics — `"a" "b"` is `"ab"`, never
 * `"a b"`). `./escape-quote-collisions.ts` handles the one real
 * correctness hazard this still leaves — a mixed-quote-style run whose
 * parts' own escaping was only ever safe under each part's *original*
 * delimiter — as a separate step, once a single representative delimiter
 * has been chosen.
 *
 * ## Representative prefix/quote choice
 *
 * Every part's prefix is guaranteed equal after Python's own
 * case-insensitive normalization by the time this runs (`isSafeToWrap`
 * refuses a mixed-prefix run outright), so reusing the first part's
 * exact-case prefix for the whole merged result is lossless. Quote
 * delimiter is not equally guaranteed (`"it's" 'safe'` mixes styles and
 * is perfectly legal Python) — the first part's own delimiter is reused
 * for every emitted part regardless, matching the plan's "record original
 * quote style" (singular): once parts are merged and freely reflowed
 * across new line boundaries, there is no single further "original style"
 * left to preserve per output line, so one consistent choice is what
 * `escapeQuoteCollisions` is there to make safe.
 */
export function dissolveString(region: WrappableRegion, source: string): DissolvedString {
  const parts = region.parts.map((part) => parsePart(sliceSpanText(source, part)));
  const first = parts[0]!;

  return {
    text: parts.map((part) => part.body).join(''),
    prefix: first.prefix,
    quoteDelimiter: first.quoteDelimiter,
  };
}
