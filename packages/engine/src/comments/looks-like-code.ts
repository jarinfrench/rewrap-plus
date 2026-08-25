/**
 * Heuristic for recognizing a run of dissolved comment lines as
 * commented-out code rather than prose, so dissolve can route it to a
 * `verbatim` block instead of reflowing it (Phase 6's gold-fixture list
 * calls this out explicitly: "commented-out code (should be verbatim —
 * detect via high punctuation density / parseability)").
 *
 * This is the comment-side counterpart to Phase 9's prose heuristic for
 * string literals — same motivation (don't mangle something that isn't
 * prose), much simpler scope. A wrong "prose" guess reflows a disabled
 * function definition into something that no longer round-trips back to
 * valid source if someone re-enables it; a wrong "code" guess merely
 * leaves a few lines of ordinary prose unwrapped, which is cosmetically
 * worse but never corrupts anything. That asymmetry is why ties lean
 * toward "code" — see the threshold chosen below.
 *
 * Deliberately line-oriented and majority-voted over a whole run rather
 * than per-line: a single stray line inside an otherwise prose comment
 * shouldn't flip the whole block to verbatim, and a single stray prose
 * sentence inside disabled code shouldn't pull the rest of the block out
 * of verbatim either.
 *
 * ## Why this lives at the engine level, not under `languages/python/`
 *
 * Phase 6's first version of this hardcoded Python's own leading-keyword
 * list (`def `, `class `, `import `, ...) directly inside the function,
 * imported straight into `dissolveLineComments`. That made
 * `dissolveLineComments` — otherwise fully generic, driven entirely by a
 * `LanguageDescriptor` — secretly Python-only: the Phase 6b JavaScript
 * canary would have needed either its own fork of the whole function or
 * a duplicate of this one with `function `/`const `/`let `/... swapped
 * in. Splitting the *pattern* out to
 * `LanguageDescriptor.comments.codeLikeKeywords` (data, per the
 * project's "adapter is data first" rule) and keeping only the shared
 * punctuation-density math here is what makes this genuinely
 * language-agnostic — exactly the kind of leaked assumption the
 * conformance kit and canary exist to surface before Phase 7 (see
 * `docs/adapters.md`, "code-like heuristic coupled to Python keywords").
 */

/**
 * Symbol characters counted toward punctuation density. Chosen to be the
 * characters that show up constantly in code (call/subscript/block
 * syntax, operators, assignment) and rarely, in this concentration, in
 * prose — an ordinary sentence has commas and the occasional colon, not
 * a run of parens and equals signs. Deliberately language-agnostic: every
 * C-family-descended language this project targets (Python, JavaScript/
 * TypeScript, C++) uses this same symbol vocabulary for the same
 * purposes.
 */
const CODE_PUNCTUATION = /[(){}[\]=:;.,<>+\-*/%&|^~!]/g;

/**
 * True if `line` (already stripped of its marker/leading whitespace,
 * i.e. dissolved *content*, not the raw source line) looks like a
 * fragment of code rather than a sentence of prose.
 *
 * Two independent signals, either sufficient on its own:
 *
 * - A leading keyword/decorator/shebang match against
 *   `leadingKeywordPattern`, if the descriptor supplied one — the
 *   strong, low-false-positive signal.
 * - Punctuation density: more than 40% of a line's letters are
 *   accompanied by a code-punctuation character, *and* at least one of
 *   the more distinctly code-shaped symbols (`(`, `)`, `{`, `}`, `=`,
 *   `:`) actually appears. The second clause guards against a prose
 *   sentence that's merely comma-heavy (commas alone are in
 *   `CODE_PUNCTUATION` but not the distinctly-code set) from tripping
 *   the density threshold on their own.
 */
function isCodeLikeLine(line: string, leadingKeywordPattern: RegExp | undefined): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (leadingKeywordPattern?.test(trimmed)) {
    return true;
  }

  const letterCount = (trimmed.match(/[A-Za-z]/g) ?? []).length;
  if (letterCount === 0) {
    return false; // nothing to compute a meaningful density ratio from
  }
  const punctuationCount = (trimmed.match(CODE_PUNCTUATION) ?? []).length;
  const density = punctuationCount / letterCount;

  return density > 0.4 && /[(){}=:]/.test(trimmed);
}

/**
 * True if `lines` (dissolved comment content, one paragraph-eligible run
 * — no directive lines mixed in, those are filtered out before this is
 * called) reads as commented-out code as a whole.
 *
 * `leadingKeywordPattern` is normally `descriptor.comments.codeLikeKeywords`
 * — optional, per that field's own doc comment: a language that doesn't
 * supply one still gets the punctuation-density signal alone, weaker but
 * never absent.
 *
 * Majority vote across non-blank lines, per the doc comment above.
 * Empty input is never code-like (nothing to route to verbatim over an
 * empty run in the first place).
 */
export function looksLikeCommentedOutCode(
  lines: readonly string[],
  leadingKeywordPattern?: RegExp,
): boolean {
  const nonEmpty = lines.filter((line) => line.trim().length > 0);
  if (nonEmpty.length === 0) {
    return false;
  }
  const codeLikeCount = nonEmpty.filter((line) =>
    isCodeLikeLine(line, leadingKeywordPattern),
  ).length;
  return codeLikeCount / nonEmpty.length >= 0.5;
}
