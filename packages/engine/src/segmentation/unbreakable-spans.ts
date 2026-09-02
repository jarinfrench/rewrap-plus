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
 * Patterns for the unbreakable forms atom segmentation needs to
 * recognize:
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
 *
 * ## `ESCAPE_SEQUENCE` is one shared pattern for every language, not one per adapter
 *
 * This module has no per-language hook — `atomizeWords` (its one real
 * caller) runs on plain text with no `LanguageDescriptor` in reach, for
 * comments/docstrings/strings across every adapter alike. `ESCAPE_SEQUENCE`
 * was originally shaped after Python's own escape grammar specifically
 * (`\x` exactly 2 hex digits, `\u`/`\U` fixed 4/8), and stayed that way
 * even after C++, Java, and JavaScript/TypeScript adapters were added —
 * each of which declares its own, more accurate
 * `LanguageDescriptor.strings.escapes.sequences` (see e.g.
 * `../languages/cpp/descriptor.ts`), but nothing ever actually reads that
 * field at runtime; it's descriptive data only, the same as `RawFormSpec`.
 *
 * That gap was a real, confirmed string-corruption bug, not just a missed
 * nicety: C++'s `\x` consumes however many hex digits follow (unlike
 * Python's fixed 2), so `\x1234` in a C++ string only had its first two
 * digits (`\x12`) recognized as the escape span here. A `wrapCppString`
 * split landing between the recognized `\x12` and the unrecognized
 * trailing `34` produced `"...\x12" "34..."` — a different *character*
 * (`0x12`, then two literal digit characters) than the original single
 * `0x1234` character, reproduced directly against the real `emitString`
 * pipeline while auditing this module. JavaScript/TypeScript's ES2015
 * `\u{1F600}`-style codepoint escape (used for emoji and any character
 * outside the BMP) had no representation here at all — only the fixed
 * 4-digit `\uXXXX` form — so a split there is worse than a wrong value:
 * `"...\u"` with the codepoint's digits and closing brace pushed onto a
 * new concatenated literal is a `SyntaxError`, also reproduced directly
 * the same way.
 *
 * The fix is a deliberately generous *union* of every escape shape any
 * supported language actually uses, rather than plumbing
 * `strings.escapes.sequences` through `atomizeWords`'s call sites (many,
 * language-agnostic by design, not worth an interface change for this).
 * Recognizing a shape that happens not to be a real escape in whatever
 * language the current text came from is always safe here — the *only*
 * thing a span means to this module is "never split inside this," and
 * refusing to split somewhere a split would in fact have been fine is a
 * missed cosmetic opportunity, never a correctness bug (the same
 * asymmetry `../comments/looks-like-code.ts`'s own doc comment leans on).
 * Erring toward recognizing more, not less, is therefore strictly the
 * safe direction:
 *
 * - `x[0-9A-Fa-f]+` (was `x[0-9A-Fa-f]{2}`): C++'s unbounded-hex-digit
 *   `\x` now stays one span regardless of how many digits follow, at the
 *   cost of also over-consuming past Python's fixed-2-digit boundary in
 *   the rare case a `\x41` is immediately followed by more hex digits
 *   meant as separate literal text — over-grouping, not corruption.
 * - `[0-7]{1,3}` (replaces the old bare `0` in the leading
 *   single-character class): C++/Java/Python octal escapes (`\101`,
 *   `\12`, ...) all use 1-3 octal digits. The old code's total
 *   non-recognition of any octal digit but `0` didn't itself cause a
 *   split (a wholly-unrecognized escape simply merges into the ordinary
 *   surrounding non-whitespace atom, never creating a false split
 *   boundary on its own) but is incidentally now also exact.
 * - `u\{[0-9A-Fa-f]+\}` (new): JavaScript/TypeScript's ES2015 code-point
 *   escape. Unambiguous next to the existing fixed-width
 *   `u[0-9A-Fa-f]{4}` alternative — the character right after `u` is
 *   either `{` or a hex digit, never both, so trying either order finds
 *   the same match.
 * - `\?` (new, folded into the leading single-character class as `?`):
 *   C++'s escaped question mark (`\?`, historically for trigraph
 *   avoidance) — cheap to add, and `../languages/cpp/descriptor.ts`
 *   already declares it as real C++ grammar.
 *
 * None of these additions introduces its own catastrophic-backtracking
 * risk: each is either a single bounded quantifier (`{1,3}`) or a single
 * unbounded quantifier immediately followed by a required literal
 * terminator (`+` then `\}`), never two adjacent quantifiers over
 * overlapping character classes — the shape that made
 * `../prose-heuristic.ts`'s own regexes a confirmed quadratic-blowup
 * hazard (see that module's own doc comments on
 * `REGEX_SHAPED`/`PLACEHOLDER_PATTERN` for the sibling finding and fix).
 */
// `[^`\n]+`, not `[^`\n]*`: a bare Markdown code-fence delimiter
// (```` ``` ````, three-plus consecutive backticks with nothing between
// them) is not itself a meaningful inline code span, but `*` let it be
// misread as one anyway — starting at the first backtick, `` ` `` then
// zero-width `[^`\n]*` then a closing `` ` `` matches just the first two
// backticks as an *empty* span, stranding the third as its own ordinary,
// separately-breakable atom. Confirmed directly while building a
// docstring fixture with a fenced code sample inside a Google-style
// field-entry description (where fenced-code detection never applies —
// `../docs/field-entries.ts`'s own doc comment on why — so the fence
// delimiter reaches `atomizeWords` as ordinary text): reflow placed a
// line break between the stray third backtick and the following word,
// rendering ` `` \ndeploy(...)` `` ` — two backticks, a real line break,
// then a lone backtick glued to unrelated text. Requiring at least one
// character of real content between the backticks is enough: with `+`, a
// bare `` ``` `` no longer matches this pattern at any starting position,
// so it falls through to the ordinary non-whitespace-run atom instead —
// still not preserved as a *fence*, but no longer torn into a fake empty
// span plus a stray glued backtick either.
const REST_ROLE = /:[A-Za-z][\w-]*:`[^`\n]+`/;
const INLINE_CODE = /`[^`\n]+`/;
// `{0,31}`, not `*`: the same quadratic-backtracking hazard as
// `../prose-heuristic.ts`'s own URL check (see that module's doc comment
// on the fix there for the full mechanism), confirmed directly here too —
// a 150,000-character run of plain letters with no `:` anywhere took
// ~20 seconds on this `.test()` call alone, and this pattern runs on
// every comment/docstring/string line `atomizeWords` ever segments, a far
// hotter path than the prose heuristic's one-call-per-string gate. Bounded
// to the same generous 32-character total scheme length.
const URL = /[a-zA-Z][a-zA-Z0-9+.-]{0,31}:\/\/\S+/;
// f-string interpolations and `str.format`/f-string placeholders share
// one brace-balanced pattern (one level of nesting — enough for a
// nested format spec like `{value:{width}}` — is as far as a regex can
// reasonably go without a real parser, and this is a heuristic
// segmenter, not one).
const BRACE_PLACEHOLDER = /\{(?:[^{}]|\{[^{}]*\})*\}/;
const PERCENT_PLACEHOLDER = /%(?:\([^)\n]*\))?[#0\- +]?\d*(?:\.\d+)?[diouxXeEfFgGcrsa%]/;
const ESCAPE_SEQUENCE =
  /\\(?:[\\'"abfnrtv?]|[0-7]{1,3}|x[0-9A-Fa-f]+|u\{[0-9A-Fa-f]+\}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}|N\{[^}\n]*\})/;

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
 *
 * `extraPatterns` — a prose language's own never-split forms
 * (`docs/planning/markdown-latex-plan.md` §4.3: LaTeX's `\verb`/
 * `\lstinline`, whose *contents* the grammar itself doesn't protect from
 * being torn at internal whitespace — see `docs/parsing.md` Finding 8) —
 * are merged into the alternation *ahead of* the built-in patterns above,
 * for this call only: a fresh combined `RegExp` is built per call rather
 * than mutating the shared module-level `UNBREAKABLE_PATTERN`, so one
 * caller's extra patterns can never leak into another's (or into a later
 * call with none). "Ahead of" matters when two patterns could both match
 * at the same starting index — JS regex alternation prefers the earlier
 * alternative, so a caller-supplied pattern gets first refusal over a
 * built-in one that happens to overlap it, matching how a `\verb|url|`
 * argument should stay one unbreakable span even though its contents
 * might otherwise look URL-shaped to the built-in `URL` pattern.
 *
 * Each pattern in `extraPatterns` must be self-contained and non-global
 * (no `g` flag — this function always builds and drives its own combined
 * `RegExp`, the same expectation every other regex-array consumer in this
 * codebase already has of caller-supplied patterns, e.g.
 * `LanguageDescriptor.comments.neverReflow`) and must respect this
 * module's own no-adjacent-unbounded-quantifiers rule (see the
 * `ESCAPE_SEQUENCE`/`URL` doc comments above for the catastrophic-
 * backtracking hazard this guards against) — a required, bounded
 * terminator like `\verb`'s own matching delimiter character keeps a
 * `[^\n]*?` lazy quantifier safe the way an unanchored greedy one
 * wouldn't be.
 */
export function findUnbreakableSpans(
  line: string,
  extraPatterns?: readonly RegExp[],
): UnbreakableSpan[] {
  const pattern =
    extraPatterns && extraPatterns.length > 0
      ? new RegExp(
          [...extraPatterns, UNBREAKABLE_PATTERN].map((re) => re.source).join('|'),
          'g',
        )
      : UNBREAKABLE_PATTERN;

  const spans: UnbreakableSpan[] = [];
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) {
    spans.push({ start: match.index, end: match.index + match[0].length });
    // A zero-length match would otherwise loop forever; none of the
    // patterns above can match empty, but guard anyway since this is a
    // `while` over mutable `lastIndex`.
    if (match[0].length === 0) {
      pattern.lastIndex++;
    }
  }
  return spans;
}
