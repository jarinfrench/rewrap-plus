import type { WrappableRegion } from '../../types/region.js';
import { sliceSpanText } from '../../discovery/slice-span.js';

/**
 * Matches a string literal's leading prefix letters and a *triple*-quote
 * opening delimiter specifically — narrower than `./prefix.ts`'s own
 * `PREFIX_AND_QUOTE` (which also matches a single `'`/`"`), since every
 * caller of this module only ever cares about the triple-quote shape.
 */
const TRIPLE_QUOTE_OPEN = /^[A-Za-z]{0,3}('''|""")/;

/**
 * True if `region` is a single-part `'stringLiteral'` whose one part opens
 * with a triple-quote delimiter (`'''`/`"""`) — the shape the
 * docstring-style wrap pipeline (`./wrap-code-string.ts`) targets.
 *
 * Deliberately `region.parts.length === 1` only: a concatenation run with
 * a triple-quoted part (`"""a""" """b"""`, or a triple-quoted part mixed
 * with ordinary parts) stays out of scope here, and therefore unsafe to
 * wrap per `./adapter.ts`'s `isSafeToWrap` — `dissolveDocstring`/
 * `emitDocstring` (reused verbatim by `wrapCodeString`) are built around
 * *one* string's own quote/prefix/physical-line shape, not a multi-part
 * run's merge-and-reflow semantics the way `dissolveString`/`emitString`
 * handle ordinary concatenation.
 *
 * Shared by three call sites that all need the identical answer:
 * `./adapter.ts`'s `isSafeToWrap` (whether this region may be wrapped at
 * all) and `proseText` (which dissolve function to score), and
 * `./wrap-string.ts`'s `wrapString` (which whole pipeline to run) — one
 * shared predicate rather than three independent regex checks that could
 * silently drift apart.
 */
export function isSingleTripleQuotedLiteral(region: WrappableRegion, source: string): boolean {
  return (
    region.parts.length === 1 && TRIPLE_QUOTE_OPEN.test(sliceSpanText(source, region.parts[0]!))
  );
}
