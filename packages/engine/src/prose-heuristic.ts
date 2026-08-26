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
  if (/\w+:\/\/\S/.test(trimmed)) {
    score -= 4; // URL
  }
  if (/[[\]$^]|\{\d+,?\d*\}/.test(trimmed)) {
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

const PLACEHOLDER_PATTERN = /\{[^{}]*\}|%\([a-zA-Z_][a-zA-Z0-9_]*\)[-+ #0]*\d*(\.\d+)?[a-zA-Z%]|%[-+ #0]*\d*(\.\d+)?[a-zA-Z%]/g;
