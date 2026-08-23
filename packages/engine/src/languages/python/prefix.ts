/**
 * A parsed Python string-literal prefix, e.g. the `rb` in `rb"..."`.
 */
export interface ParsedPrefix {
  /** True if the prefix disables escape processing (`r`, `rb`, `rf`, and case variants). */
  readonly raw: boolean;
  /** True if the prefix marks a byte string (`b`, `rb`, and case variants). */
  readonly bytes: boolean;
  /** True if the prefix marks a formatted/f-string (`f`, `rf`, and case variants). */
  readonly formatted: boolean;
  /**
   * Canonical form: lowercase, letters sorted and de-duplicated. Two
   * prefixes that mean the same thing regardless of letter order or case
   * (`rb`/`br`/`Rb`/`bR`) always normalize to the same string, which is
   * what makes comparing prefixes across a concatenation run's parts
   * meaningful (see `isSafeToWrap` in `./adapter.ts`).
   */
  readonly normalized: string;
}

/**
 * Matches a string literal's leading prefix letters and opening quote,
 * e.g. `rb"` or `"""` (empty prefix). Quote forms are checked
 * longest-first so `"""` doesn't short-circuit on the first `"`.
 */
const PREFIX_AND_QUOTE = /^([A-Za-z]{0,3})('''|"""|'|")/;

/**
 * Extract the lowercase prefix from the start of a Python string literal's
 * exact source text (including its quotes), e.g. `extractPrefix('Rb"x"')`
 * → `'rb'`, `extractPrefix('"""x"""')` → `''`.
 *
 * Returns `null` if `literalText` doesn't start with a recognizable
 * prefix-plus-quote sequence at all — a defensive case that shouldn't
 * arise for text sliced from a genuine `string`-query capture, but callers
 * (`isSafeToWrap`) treat it as "assume unsafe" rather than throwing, since
 * this is reachable with attacker-shaped input in principle and a wrong
 * "safe" is a much worse failure mode than a wrong "unsafe."
 */
export function extractPrefix(literalText: string): string | null {
  const match = PREFIX_AND_QUOTE.exec(literalText);
  return match ? match[1]!.toLowerCase() : null;
}

/**
 * Canonicalize a lowercase prefix by sorting and de-duplicating its
 * letters — `'rb'`, `'br'` (already lowercased by `extractPrefix`) both
 * become `'br'`. Python doesn't allow repeated letters in a real prefix
 * (`rr"..."` is a syntax error), so de-duplication is defensive rather
 * than load-bearing, but costs nothing to include.
 */
function normalize(prefix: string): string {
  return [...new Set(prefix)].sort().join('');
}

/**
 * Classify a lowercase prefix string (as returned by `extractPrefix`)
 * into its raw/bytes/formatted flags plus a canonical `normalized` form.
 */
export function classifyPrefix(prefix: string): ParsedPrefix {
  const normalized = normalize(prefix);
  return {
    raw: normalized.includes('r'),
    bytes: normalized.includes('b'),
    formatted: normalized.includes('f'),
    normalized,
  };
}
