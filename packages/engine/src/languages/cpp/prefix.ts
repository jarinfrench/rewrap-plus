/**
 * Matches a C++ string literal's leading encoding prefix and opening
 * quote, e.g. the `L` in `L"wide"` or the `u8` in `u8"utf8"` (empty
 * prefix matches too, for a bare `"..."`). Unlike Python's prefix letters
 * (`r`, `b`, `f`, freely combinable and case-insensitive), C++'s encoding
 * prefixes are a small closed set of exact, case-sensitive spellings --
 * `L`, `u`, `U`, `u8` -- confirmed directly against the vendored grammar
 * (`docs/spikes/tree-sitter-cpp-probe.mjs`; a `string_literal` node's own
 * source text carries whichever one was written baked into the same
 * token as its opening quote). `u8` is tried before the bare `u`/`U`
 * alternatives so a `u8"..."` literal doesn't short-circuit on matching
 * just `u` and then fail to find `"` where `8` actually sits.
 */
const PREFIX_AND_QUOTE = /^(u8|[LuU])?"/;

/**
 * Extract a string literal's exact encoding prefix from its exact source
 * text (including its quotes), e.g. `extractPrefix('L"wide"')` -> `'L'`,
 * `extractPrefix('"plain"')` -> `''`.
 *
 * Returns `null` if `literalText` doesn't start with a recognizable
 * prefix-plus-quote sequence at all -- a defensive case that shouldn't
 * arise for text sliced from a genuine `string_literal`-query capture
 * (`raw_string_literal`/`char_literal` are separate node types this
 * descriptor's `queries.strings` never captures -- see `./descriptor.ts`'s
 * own doc comment), but `isSafeToWrap` (`./adapter.ts`) treats this as
 * "assume unsafe" rather than throwing, the same posture Python's own
 * `extractPrefix` (`../python/prefix.ts`) takes for the identical reason:
 * a wrong "safe" is a much worse failure mode than a wrong "unsafe."
 */
export function extractPrefix(literalText: string): string | null {
  const match = PREFIX_AND_QUOTE.exec(literalText);
  return match ? (match[1] ?? '') : null;
}
