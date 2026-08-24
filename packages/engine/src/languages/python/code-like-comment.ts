/**
 * Heuristic for recognizing a run of comment lines as commented-out code
 * rather than prose, so dissolve can route it to a `verbatim` block
 * instead of reflowing it (Phase 6's gold-fixture list calls this out
 * explicitly: "commented-out code (should be verbatim — detect via high
 * punctuation density / parseability)").
 *
 * This is the comment-side counterpart to Phase 9's prose heuristic for
 * string literals — same motivation (don't mangle something that isn't
 * prose), much simpler scope. A wrong "prose" guess here reflows a
 * disabled function definition into something that no longer round-trips
 * back to valid Python if someone re-enables it; a wrong "code" guess
 * merely leaves a few lines of ordinary prose unwrapped, which is
 * cosmetically worse but never corrupts anything. That asymmetry is why
 * ties lean toward "code" — see the threshold chosen below.
 *
 * Deliberately line-oriented and majority-voted over a whole run rather
 * than per-line: a single stray line inside an otherwise prose comment
 * (`# NB: don't set x = 0 here`) shouldn't flip the whole block to
 * verbatim, and a single stray prose sentence inside disabled code
 * (`# TODO: remove this once the API is fixed`) shouldn't pull the rest
 * of the block out of verbatim either.
 */

/**
 * Lines beginning with one of Python's statement/definition keywords, a
 * decorator, or a shebang — enough on their own to call a line code-like
 * without needing the punctuation-density signal too. Anchored to the
 * start of the (already-trimmed) line: these are keywords Python only
 * ever uses in statement-leading position, so a false positive would
 * require a prose sentence that happens to start the same way (rare
 * enough, and the same failure mode a real linter accepts).
 */
const CODE_LEADING_KEYWORD =
  /^(def |class |import |from |return\b|if |elif |else\s*:|for |while |with |try\s*:|except|finally\s*:|raise |yield |lambda |async |await |assert |global |nonlocal |del |pass\s*$|break\s*$|continue\s*$|@\w|#!)/;

/**
 * Symbol characters counted toward punctuation density. Chosen to be the
 * characters that show up constantly in code (call/subscript/block
 * syntax, operators, assignment) and rarely, in this concentration, in
 * prose — an ordinary sentence has commas and the occasional colon, not
 * a run of parens and equals signs.
 */
const CODE_PUNCTUATION = /[(){}[\]=:;.,<>+\-*/%&|^~!]/g;

/**
 * True if `line` (already stripped of its `#`/leading whitespace, i.e.
 * the dissolved *content*, not the raw source line) looks like a
 * fragment of code rather than a sentence of prose.
 *
 * Two independent signals, either sufficient on its own:
 *
 * - A leading keyword/decorator/shebang (`CODE_LEADING_KEYWORD`) — the
 *   strong, low-false-positive signal.
 * - Punctuation density: more than 40% of a line's letters are
 *   accompanied by a code-punctuation character, *and* at least one of
 *   the more distinctly code-shaped symbols (`(`, `)`, `{`, `}`, `=`,
 *   `:`) actually appears. The second clause guards against a prose
 *   sentence that's merely comma-heavy (commas alone are in
 *   `CODE_PUNCTUATION` but not the distinctly-code set) from tripping
 *   the density threshold on their own.
 */
function isCodeLikeLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (CODE_LEADING_KEYWORD.test(trimmed)) {
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
 * Majority vote across non-blank lines, per the doc comment above.
 * Empty input is never code-like (nothing to route to verbatim over an
 * empty run in the first place).
 */
export function looksLikeCommentedOutCode(lines: readonly string[]): boolean {
  const nonEmpty = lines.filter((line) => line.trim().length > 0);
  if (nonEmpty.length === 0) {
    return false;
  }
  const codeLikeCount = nonEmpty.filter(isCodeLikeLine).length;
  return codeLikeCount / nonEmpty.length >= 0.5;
}
