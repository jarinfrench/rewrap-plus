/**
 * Detect whether `source` uses CRLF or LF line endings, from its first
 * line break.
 *
 * Every dissolve/emit function in this package (`emitLineComments`, and
 * whatever emit functions later phases add) builds its output with bare
 * `\n` internally — reflow, width budgeting, and block joining have no
 * reason to think about line-ending bytes, since a `\r` is zero-width
 * and irrelevant to any of that math. Matching the *source* file's own
 * convention is squarely a concern for whoever assembles the final
 * `TextEdit`, not for the emit functions themselves — see `./wrap.ts`,
 * which calls this once per `wrapRegions` invocation and substitutes
 * accordingly before an edit is ever compared or returned.
 *
 * Only the *first* line break is inspected — one file is assumed to use
 * one convention consistently, matching the plan's own framing of this
 * as a per-file property ("detect and preserve CRLF vs LF **per file**",
 * Phase 10). A file with genuinely mixed line endings is out of scope
 * here; Phase 10 ("engine: add line ending and trailing whitespace
 * preservation") is where that general hardening belongs. What this
 * function exists for now is narrower and more basic: make the Python
 * adapter's own wrap output consistent with the file it's wrapping,
 * which is also exactly what the Phase 6b conformance kit's own
 * invariant ("line endings ... preserved") requires to be true before
 * that kit can pass.
 *
 * A source with no line break at all (a single-line file) has nothing
 * to detect from; `'\n'` is returned as the conservative default, since
 * every other "no signal" fallback in this package prefers `\n` (e.g.
 * `DissolvedLineComments.spaceAfterMarker`'s own doc comment).
 */
export function detectLineEnding(source: string): '\n' | '\r\n' {
  const index = source.indexOf('\n');
  if (index > 0 && source[index - 1] === '\r') {
    return '\r\n';
  }
  return '\n';
}

/**
 * Rewrite every bare `\n` in `text` to `lineEnding`. A no-op when
 * `lineEnding` is already `'\n'`.
 *
 * Safe to apply unconditionally to emit output because no dissolve/emit
 * function in this package ever produces a literal `\r` of its own —
 * Python source has no escape sequence whose *unescaped* form is a bare
 * carriage return that would need protecting from this substitution (the
 * closest is `\r` written as the two-character escape `\\r` inside a
 * string literal, which stays two characters, `\` and `r`, through
 * dissolve/reflow/emit and is never unescaped to an actual `\r` byte —
 * see Phase 9's dissolve commit for where real unescaping happens, once
 * string wrapping exists).
 */
export function applyLineEnding(text: string, lineEnding: '\n' | '\r\n'): string {
  return lineEnding === '\n' ? text : text.replace(/\n/g, lineEnding);
}
