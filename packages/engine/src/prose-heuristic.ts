/**
 * Score whether `text` reads as wrappable prose, for `WrapConfig.stringPolicy:
 * 'prose'` (the conservative default — wraps only strings that score as
 * prose-like under this heuristic). Language-agnostic and operates on
 * plain text only: it knows nothing about Python, tree-sitter, or any
 * particular call context, unlike the *context* signals this project also
 * cares about (a string used as a dict key, or as the sole argument to
 * `re.compile`/`open`/a logging call) — those need real syntax-tree access
 * to answer correctly and live in `LanguageAdapter.isSafeToWrap`
 * (`./languages/python/adapter.ts`) instead, per that hook's own doc
 * comment ("eligibility beyond the shared prose heuristic").
 *
 * This is inherently a heuristic, not a specification with an exact
 * pass/fail boundary — only qualitative signals ("positive," "negative,"
 * "context") drive it. Each signal below nudges a running score up or
 * down; `text` is eligible once the total is strictly positive. The
 * concrete weights were tuned against this package's own gold fixtures
 * (`test/fixtures/python/strings/`), not derived from a formula —
 * expect to retune them if a real-world false positive/negative surfaces
 * later, the same way any heuristic in this codebase
 * (`./comments/looks-like-code.ts`, `./segmentation/verbatim.ts`) is
 * expected to evolve.
 */
export function looksLikeProse(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return false;
  }

  const words = trimmed.split(/\s+/).filter((w) => w.length > 0);
  const spaceCount = (trimmed.match(/ /g) ?? []).length;

  let score = 0;

  // --- Positive signals -----------------------------------------------
  if (spaceCount >= 2) {
    score += 1; // multiple spaces: more than a two-word fragment
  }
  if (/[.,!?;:]/.test(trimmed)) {
    score += 1; // sentence-shaped punctuation somewhere in the text
  }
  if (trimmed.length > 60) {
    score += 1; // long enough that it's very likely meant as a message
  }
  const dictionaryShaped = words.filter((w) => /^[A-Za-z][A-Za-z'-]*[.,!?;:]?$/.test(w));
  if (words.length > 0 && dictionaryShaped.length / words.length >= 0.6) {
    score += 1; // most tokens look like ordinary words, not identifiers/code
  }

  // --- Negative signals --------------------------------------------------
  //
  // The five checks below are near-definitive disqualifiers, not soft
  // signals (a path, a URL, a regex, a SQL keyword, or a single
  // identifier-shaped token essentially never coexists with genuine
  // prose) — each is weighted -4, strictly more than the +4 every
  // positive signal above could sum to at most, so one of these always
  // wins regardless of how many positive signals also happen to fire.
  // Found necessary, not just tidy, by this phase's own SQL-query gold
  // fixture: quoted (`"SELECT ... FROM ..."`) it correctly scored
  // negative, but the identical text *without* its surrounding quote
  // characters scored positive at the originally-chosen -3 weight — the
  // quote characters were incidentally defeating the dictionary-word-shape
  // check on the first/last token, which was just enough to tip the
  // unweighted balance despite the SQL match. `-4` closes that gap
  // structurally rather than chasing the specific coincidence that
  // exposed it.
  if (/^[A-Za-z]:[\\/]/.test(trimmed) || /[\\/][\w.-]+[\\/]/.test(trimmed)) {
    score -= 4; // drive-letter or slash-delimited path shape
  }
  // `\w{1,32}`, not `\w+`: an unbounded quantifier immediately followed
  // by a required literal (`://`) that never appears anywhere in the
  // text costs `O(k)` for a run of `k` word characters at *each* of the
  // `k` positions the regex tries starting inside that run — `\w+`
  // greedily consumes the rest of the run, backtracks one character at a
  // time looking for the `:` that isn't there, gives up, and the next
  // starting position repeats the same backtrack over one-shorter a run.
  // Confirmed directly: a 200,000-character run of plain digits or
  // letters with no colon anywhere took ~28 seconds on this `.test()`
  // call alone — found while re-checking every regex in this file after
  // fixing the two adjacent-quantifier cases below, not by inspection
  // alone. Real URL schemes are short (`http`, `https`, `ftp`,
  // `mailto`, even a generous custom one) — 32 characters is far more
  // than any real scheme needs, and bounding the quantifier caps the
  // backtrack cost at each starting position to a constant, which is
  // what removes the quadratic blowup (the same fix shape as
  // `../segmentation/unbreakable-spans.ts`'s own `URL` pattern, which
  // has the identical hazard for the identical reason).
  if (/\w{1,32}:\/\/\S/.test(trimmed)) {
    score -= 4; // URL
  }
  // `\d+(?:,\d*)?`, not `\d+,?\d*`: the original wrote the optional comma
  // and the optional trailing digits as two independent quantifiers
  // sitting directly next to `\d+`'s own — since `,` is optional, that
  // left `\d+\d*` with no fixed boundary between them, so a run of digits
  // could be split between the two quantifiers in `O(n)` different ways
  // for a backtracking engine to try. Confirmed directly, not just
  // suspected: a `{` followed by ~80,000 digits and no closing `}` (a
  // single oversized string literal is exactly the "one crafted file"
  // shape this heuristic runs on) took several seconds on this `.test()`
  // call alone, growing quadratically with input length. Requiring the
  // comma before any second run of digits (`(?:,\d*)?` as one unit)
  // removes the ambiguity — there is now exactly one way to partition any
  // given input between the two quantifiers — without changing which
  // `{n}`/`{n,}`/`{n,m}` shapes count as regex-looking.
  if (/[[\]$^]|\{\d+(?:,\d*)?\}/.test(trimmed)) {
    score -= 4; // regex-shaped punctuation (character classes, anchors, {n,m})
  }
  const weakSqlMatches = trimmed.match(SQL_WEAK_KEYWORDS) ?? [];
  const distinctWeakSqlKeywords = new Set(weakSqlMatches.map((w) => w.toUpperCase()));
  if (SQL_STRONG_KEYWORDS.test(trimmed) || distinctWeakSqlKeywords.size >= 2) {
    score -= 4;
  }
  if (spaceCount === 0 && words.length <= 1 && /^[a-z0-9_]+(\.[a-z0-9_]+)*$/i.test(trimmed)) {
    score -= 4; // a single snake_case/dotted identifier-shaped token — a key, not prose
  }
  const symbolCount = (trimmed.match(/[^A-Za-z0-9\s]/g) ?? []).length;
  if (symbolCount / trimmed.length > 0.3) {
    score -= 2; // high symbol density
  }
  const placeholderMatches = trimmed.match(PLACEHOLDER_PATTERN) ?? [];
  if (words.length > 0 && placeholderMatches.length / words.length >= 0.4) {
    score -= 2; // dominated by format placeholders rather than words
  }

  return score > 0;
}

/**
 * SQL-keyword detection is split into two tiers, rather than one flat
 * alternation, after a real false positive surfaced while building Phase
 * 12f's own gold fixtures: `SELECT`/`INSERT INTO`/`UPDATE`/`DELETE
 * FROM`/`CREATE TABLE`/`DROP TABLE` are vanishingly rare as ordinary
 * English (nobody writes "insert into" or "drop table" outside SQL), so
 * matching any one of them alone is a safe, near-definitive disqualifier —
 * these stay in `SQL_STRONG_KEYWORDS`. `FROM`/`WHERE`/`JOIN`/`VALUES` are
 * common English words in their own right ("separated *from* the first",
 * "the *values* here") that show up constantly in genuine prose; a
 * hand-written prose paragraph containing only the word "from" scored +4
 * on every positive signal above but was driven to a final score of
 * exactly 0 (ineligible) by a single match against the old flat regex.
 * These move to `SQL_WEAK_KEYWORDS` and only count as a SQL signal when at
 * least two *distinct* ones co-occur (`FROM ... WHERE`, `JOIN ...
 * VALUES`, ...) — the co-occurrence a real query almost always has and a
 * stray English sentence almost never does.
 */
const SQL_STRONG_KEYWORDS = /\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE|DROP\s+TABLE)\b/i;
const SQL_WEAK_KEYWORDS = /\b(FROM|WHERE|JOIN|VALUES)\b/gi;

// The flags class is bounded (`{0,5}`, not `*`): printf-style flags
// (`-`, `+`, ` `, `#`, `0`) never realistically repeat more than a
// couple of times, but `0` is also a digit, so an unbounded `[-+
// #0]*` directly followed by `\d*` let a run of `0` characters be
// split between the two quantifiers in exponentially many ways — the
// same catastrophic-backtracking shape as `{n,m}`'s own fix just
// above, confirmed the same way (a `%` followed by ~80,000 `0`
// characters and no valid conversion character took over 13 seconds on
// this pattern alone). Five flag characters is already far more than
// any real format string uses; bounding it turns the ambiguous split
// into a small constant number of cases regardless of input length,
// which is what actually removes the blowup (the digits afterward stay
// an ordinary, unbounded `\d*` — safe on its own, since nothing else
// adjacent to it shares its character class).
const PLACEHOLDER_PATTERN = /\{[^{}]*\}|%\([a-zA-Z_][a-zA-Z0-9_]*\)[-+ #0]{0,5}\d*(\.\d+)?[a-zA-Z%]|%[-+ #0]{0,5}\d*(\.\d+)?[a-zA-Z%]/g;
