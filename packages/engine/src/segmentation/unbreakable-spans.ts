/**
 * A contiguous range of a line that atom segmentation must never split,
 * even at internal whitespace. `[start, end)`, UTF-16 code-unit offsets
 * into the line (consistent with every other offset in this package that
 * isn't explicitly a tree-sitter byte offset — see
 * `../types/span.ts`'s UTF-8/UTF-16 note).
 */
export interface UnbreakableSpan {
  readonly start: number;
  readonly end: number;
}

/**
 * Patterns for the unbreakable forms the plan calls out for atom
 * segmentation (Phase 5, "add atom segmentation with unbreakable unit
 * support"):
 *
 * - escape sequences (`\n`, `\t`, `\\`, `\x41`, `\u1234`, `\U0001F600`,
 *   `\N{NAME}`) — none of these contain whitespace, so word-splitting
 *   alone never breaks one internally; they're still matched here so a
 *   later phase (dissolve/emit) can rely on `atomizeWords` having
 *   identified them, rather than re-deriving the same regex.
 * - format placeholders (`{}`, `{0}`, `{name!r:>10}`, `%s`, `%(key)d`)
 *   and f-string interpolations (`{expr}`, including nested braces and a
 *   trailing format spec) — these *can* contain whitespace (`{a + b}`),
 *   which is the real reason this module exists: plain `\S+` splitting
 *   would otherwise tear the interpolation apart at that internal space.
 * - inline code spans (`` `x` ``) and reST roles (`` :func:`x` ``) — same
 *   internal-whitespace hazard as interpolations.
 *
 * URLs and filesystem paths are deliberately absent from this list: by
 * construction they contain no whitespace, so a maximal non-whitespace
 * run already keeps one whole without any special-casing here.
 *
 * Order matters: patterns are tried earliest-starting-index-first via a
 * single alternation, but among matches starting at the *same* index the
 * earlier alternative wins (JS regex alternation semantics) — reST role
 * is listed before inline code so `:func:`x`` is captured whole rather
 * than being torn at the leading `:func:` prefix.
 */
const REST_ROLE = /:[A-Za-z][\w-]*:`[^`\n]*`/;
const INLINE_CODE = /`[^`\n]*`/;
const URL = /[a-zA-Z][a-zA-Z0-9+.-]*:\/\/\S+/;
// f-string interpolations and `str.format`/f-string placeholders share
// one brace-balanced pattern (one level of nesting — enough for a
// nested format spec like `{value:{width}}` — is as far as a regex can
// reasonably go without a real parser, and this is a heuristic
// segmenter, not one).
const BRACE_PLACEHOLDER = /\{(?:[^{}]|\{[^{}]*\})*\}/;
const PERCENT_PLACEHOLDER = /%(?:\([^)\n]*\))?[#0\- +]?\d*(?:\.\d+)?[diouxXeEfFgGcrsa%]/;
const ESCAPE_SEQUENCE =
  /\\(?:[\\'"abfnrtv0]|x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}|N\{[^}\n]*\})/;

const UNBREAKABLE_PATTERN = new RegExp(
  [REST_ROLE, INLINE_CODE, URL, BRACE_PLACEHOLDER, PERCENT_PLACEHOLDER, ESCAPE_SEQUENCE]
    .map((re) => re.source)
    .join('|'),
  'g',
);

/**
 * Find every unbreakable span in `line`, left to right, non-overlapping
 * (the regex engine's own global-match cursor already guarantees this:
 * each match starts at or after the previous match's end).
 */
export function findUnbreakableSpans(line: string): UnbreakableSpan[] {
  const spans: UnbreakableSpan[] = [];
  UNBREAKABLE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = UNBREAKABLE_PATTERN.exec(line)) !== null) {
    spans.push({ start: match.index, end: match.index + match[0].length });
    // A zero-length match would otherwise loop forever; none of the
    // patterns above can match empty, but guard anyway since this is a
    // `while` over mutable `lastIndex`.
    if (match[0].length === 0) {
      UNBREAKABLE_PATTERN.lastIndex++;
    }
  }
  return spans;
}
