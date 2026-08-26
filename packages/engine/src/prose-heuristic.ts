/**
 * Score whether `text` reads as wrappable prose, for `WrapConfig.stringPolicy:
 * 'prose'` (the conservative default — "wrap only strings that score as
 * prose-like under the heuristic," per the plan). Language-agnostic and
 * operates on plain text only: it knows nothing about Python, tree-sitter,
 * or any particular call context, unlike the *context* signals the plan
 * also calls for (a string used as a dict key, or as the sole argument to
 * `re.compile`/`open`/a logging call) — those need real syntax-tree access
 * to answer correctly and live in `LanguageAdapter.isSafeToWrap`
 * (`./languages/python/adapter.ts`) instead, per that hook's own doc
 * comment ("eligibility beyond the shared prose heuristic").
 *
 * This is inherently a heuristic, not a specification with an exact
 * pass/fail boundary — the plan itself only lists qualitative signals
 * ("positive," "negative," "context"). Each signal below nudges a running
 * score up or down; `text` is eligible once the total is strictly
 * positive. The concrete weights were tuned against this phase's own gold
 * fixtures (`test/fixtures/python/strings/`), not derived from a formula —
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
  if (/^[A-Za-z]:[\\/]/.test(trimmed) || /[\\/][\w.-]+[\\/]/.test(trimmed)) {
    score -= 2; // drive-letter or slash-delimited path shape
  }
  if (/\w+:\/\/\S/.test(trimmed)) {
    score -= 3; // URL
  }
  if (/[[\]$^]|\{\d+,?\d*\}/.test(trimmed)) {
    score -= 2; // regex-shaped punctuation (character classes, anchors, {n,m})
  }
  if (SQL_KEYWORDS.test(trimmed)) {
    score -= 3;
  }
  if (spaceCount === 0 && words.length <= 1 && /^[a-z0-9_]+(\.[a-z0-9_]+)*$/i.test(trimmed)) {
    score -= 2; // a single snake_case/dotted identifier-shaped token — a key, not prose
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

const SQL_KEYWORDS =
  /\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|FROM|WHERE|JOIN|VALUES|CREATE\s+TABLE|DROP\s+TABLE)\b/i;

const PLACEHOLDER_PATTERN = /\{[^{}]*\}|%\([a-zA-Z_][a-zA-Z0-9_]*\)[-+ #0]*\d*(\.\d+)?[a-zA-Z%]|%[-+ #0]*\d*(\.\d+)?[a-zA-Z%]/g;
