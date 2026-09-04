/**
 * Markdown's hard-break detection, plus the fix Phase A's own probe found
 * was needed before this commit could ship it (`docs/parsing.md`
 * Finding 7's closing paragraph).
 *
 * Two forms are unambiguous, matched directly: two-or-more trailing
 * spaces, or a trailing `<br>`/`<br/>`/`<br />` (case-insensitive, any
 * horizontal whitespace before the optional `/`). The third —  a trailing
 * backslash — is not: CommonMark's own backslash-escaping pairs
 * consecutive backslashes left to right (`\\` is one escaped, *literal*
 * backslash, not a break), so classifying a trailing run of backslashes
 * correctly needs the run's *parity*, not merely whether the character
 * immediately before the last one is also a backslash. The plan's own
 * §5.4 text, `/(?<!\\)\\$/`, only checks one character back — correct for
 * a run of 1 or 2 trailing backslashes, wrong for 3 (which *is* a hard
 * break: two escape-paired backslashes plus one real trailing one) or
 * any other odd count beyond 1. `trailingBackslashHardBreak` below
 * implements the real rule: an odd-length trailing run is a hard break
 * (the marker being only that one final, unescaped backslash character);
 * an even-length run is not (fully escape-paired).
 */

const SPACE_OR_BR_HARD_BREAK = /([ ]{2,}|<br\s*\/?>)$/i;
const TRAILING_BACKSLASH_RUN = /\\+$/;

/**
 * A `RegExp`-shaped match result for a trailing run of an odd number of
 * backslashes: `index` points at the run's *last* character (the one
 * real, unescaped backslash), and `[0]` is just that one character — the
 * escape-paired backslashes before it are not part of the marker.
 */
function trailingBackslashHardBreak(line: string): RegExpExecArray | null {
  const run = TRAILING_BACKSLASH_RUN.exec(line);
  if (!run || run[0].length % 2 === 0) {
    return null;
  }
  const index = run.index + run[0].length - 1;
  const match = ['\\'] as unknown as RegExpExecArray;
  match.index = index;
  match.input = line;
  return match;
}

/**
 * A `RegExp`-shaped object (only `.exec` is ever called on it —
 * `../../prose/dissolve-prose.ts`'s `ProseSpec.hardBreak` contract) that
 * finds Markdown's hard-break marker at the end of a line, trying the
 * two unambiguous forms first and falling back to backslash-run parity.
 * `dissolveProse` tries each `hardBreak` entry in order and uses the
 * first that matches, so entry order here doesn't matter — the two
 * unambiguous forms and the backslash form can never both match the same
 * line's trailing text (a line cannot simultaneously end in `  ` and in
 * an odd run of `\`).
 */
const markdownHardBreak = {
  exec(line: string): RegExpExecArray | null {
    return SPACE_OR_BR_HARD_BREAK.exec(line) ?? trailingBackslashHardBreak(line);
  },
} as RegExp;

/** Markdown's `ProseSpec.hardBreak` — `../../prose/dissolve-prose.ts`. */
export const MARKDOWN_HARD_BREAK: readonly RegExp[] = [markdownHardBreak];
