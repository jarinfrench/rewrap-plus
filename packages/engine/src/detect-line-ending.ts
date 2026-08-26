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
 * Only the *first* line break is inspected — a per-file fallback for
 * when there's no more specific signal to go by. See
 * `detectLineEndingNear`, below, for the per-*region* detection Phase 10
 * ("engine: add line ending and trailing whitespace preservation") adds
 * on top of this for a file with genuinely mixed line endings — this
 * function alone remains what `detectLineEndingNear` itself falls back
 * to when a region has no nearby line break of its own to go by.
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
 * Detect the line-ending convention actually surrounding one region,
 * rather than the whole file's first line break — what makes a genuinely
 * mixed-line-ending file (Phase 10's own named pathological input) wrap
 * correctly: `wrap.ts` calls this once per region instead of computing
 * one `detectLineEnding(source)` up front and reusing it for every edit,
 * so a region living in the file's `\n`-only stretch gets `\n`-joined
 * replacement text even if the file elsewhere (or even earlier on the
 * very same line boundary) uses `\r\n`, and vice versa.
 *
 * Takes `lines` (the caller's own `source.split('\n')`) rather than
 * `source` itself and re-splitting internally — the first version of
 * this function did exactly that, and calling it once per region turned
 * "wrap every region in the file" quadratic in file size all over again
 * (`O(region count × file length)`), the same class of bug Phase 10's
 * own `PositionMapper` checkpoint fix (`./types/position-mapper.ts`)
 * exists to prevent, caught here by this phase's own benchmark work
 * before it shipped as a silent regression. Splitting once and passing
 * the result to every call, the way `discoverRegions` already does
 * internally for its own per-line indent lookups, is `O(file length)`
 * total regardless of how many regions call this.
 *
 * Looks at `row`'s own line terminator first (the row a region's own
 * `SourceSpan.startRow` names): a `'\n'`-only split leaves a trailing
 * `\r` on every line that was really `\r\n`-terminated, since only the
 * `\n` itself is consumed by the split — checking for that trailing `\r`
 * is exactly `detectLineEnding`'s own test, just applied to one line
 * instead of the whole file. Falls back to the *previous* row's own
 * terminator when `row` is the file's last line (which has no
 * terminator of its own to inspect), and to `detectLineEnding`'s
 * whole-file heuristic (reconstructing `source` by rejoining `lines`,
 * only in this rare fallback path) only when neither exists — a
 * single-line file, or `row` being both the first and the last line.
 */
export function detectLineEndingNear(lines: readonly string[], row: number): '\n' | '\r\n' {
  if (row >= 0 && row < lines.length - 1) {
    return lines[row]!.endsWith('\r') ? '\r\n' : '\n';
  }
  if (row > 0) {
    return lines[row - 1]!.endsWith('\r') ? '\r\n' : '\n';
  }
  return detectLineEnding(lines.join('\n'));
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
