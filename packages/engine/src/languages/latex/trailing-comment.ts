/**
 * Sec. 6.4's "one real semantic hazard": `text % note\nmore text` -- the `%`
 * comments out the rest of *that* physical line, so if reflow ever moved
 * `more` up onto the comment's own line, it would silently vanish from
 * the typeset output. `discoverLatexProse` (`./discover-prose.ts`) now
 * folds a trailing comment's text into the surrounding `'prose'` region's
 * own part for that row (through the row's full length) rather than
 * excluding it, so this module's job is purely the *wrap-time* half:
 * recognize that trailing text as a `ProseSpec.hardBreak` marker so
 * `dissolveProse` (`../../prose/dissolve-prose.ts`) glues it, verbatim,
 * onto the preceding atom (never reflowed, may overflow -- the same
 * overflow rule an unsplittable URL already relies on) and tags the
 * *next* line's first atom `breakBefore: true` -- both of Sec. 6.4's rules,
 * satisfied by the one existing mechanism, with no new dissolve/emit
 * code needed at all.
 *
 * ## Finding the real `%`, not a `\%`/`\\%`/... one
 *
 * A naive `[^\\]%` scan -- Rewrap's own regex, called out by the plan as
 * getting this wrong -- treats *any* `%` preceded by a backslash as
 * escaped, but LaTeX's actual rule has the same parity shape Markdown's
 * own trailing-backslash hard break needed (`../markdown/hard-break.ts`):
 * `\%` is one escaped-percent control symbol (no comment), but `\\%` is
 * the *complete* `\\` line-break control symbol followed by a genuinely
 * unescaped `%` (a real comment) -- confirmed directly against the
 * grammar, not assumed (`docs/spikes/tree-sitter-latex-probe6.mjs`: 0/2/4
 * leading backslashes all produce a real `line_comment` node; 1/3 do
 * not). `findUnescapedPercent` below counts the run of consecutive `\`
 * immediately before each `%` and checks its parity, exactly mirroring
 * `../markdown/hard-break.ts`'s `trailingBackslashHardBreak` -- a manual
 * scan rather than a lookbehind-based regex, since a variable-length
 * backslash run makes the correct pattern awkward to express as one
 * lookbehind and a manual count is easier to verify by inspection.
 *
 * This only has to be *locally* correct -- it runs on a line
 * `discoverLatexProse` has already confirmed (via the real tree) does
 * contain a trailing `line_comment` node somewhere; it isn't deciding
 * *whether* a comment exists, only *where within this line's own text*
 * it starts, which is exactly the question this function answers without
 * needing tree access at wrap time (`wrapLatexProse` only has the line's
 * raw text at this point, via `ProseSpec.hardBreak`'s plain
 * `RegExp`-shaped contract).
 */
function findUnescapedPercent(line: string): number | null {
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== '%') {
      continue;
    }
    let backslashes = 0;
    let j = i - 1;
    while (j >= 0 && line[j] === '\\') {
      backslashes++;
      j--;
    }
    if (backslashes % 2 === 0) {
      return i;
    }
    // An odd run means this particular `%` is escaped (`\%`, `\\\%`, ...)
    // -- keep scanning; a later, genuinely unescaped `%` may still exist
    // on the same line (e.g. `100\% done % a real comment`).
  }
  return null;
}

/**
 * A `RegExp`-shaped object (only `.exec` is ever called on it, matching
 * `../markdown/hard-break.ts`'s own `markdownHardBreak` pattern -- a
 * plain object satisfying `ProseSpec.hardBreak`'s contract, not a real
 * compiled `RegExp`, since this needs `findUnescapedPercent`'s parity
 * logic rather than anything expressible as a single regex without
 * risking the exact catastrophic-backtracking shape
 * `./discover-prose.ts`'s own `structuralConsumedLength` doc comment
 * already explains avoiding).
 *
 * On a match, `index` points at the real `%`'s own *whitespace-preceding*
 * boundary -- one column before the run of horizontal whitespace (if any)
 * immediately before the `%`, so `dissolveProse`'s `content = raw.slice(0,
 * match.index)` naturally drops that whitespace via `atomizeWords`'
 * ordinary trailing-whitespace handling -- and `text` (`match[0]`) is a
 * single normalized space plus the comment's own raw text through end of
 * line, *regardless* of how many literal spaces (zero or more) the
 * source actually had before `%`: whitespace before a TeX comment is
 * semantically irrelevant (the comment already discards everything to
 * end of line), so normalizing to exactly one space here is a safe,
 * non-semantic-changing choice -- not preserved-because-it-must-be, the
 * way real word-separating whitespace is elsewhere in this pipeline.
 */
const LATEX_TRAILING_COMMENT = {
  exec(line: string): RegExpExecArray | null {
    const percentIndex = findUnescapedPercent(line);
    if (percentIndex === null) {
      return null;
    }
    let contentEnd = percentIndex;
    while (contentEnd > 0 && (line[contentEnd - 1] === ' ' || line[contentEnd - 1] === '\t')) {
      contentEnd--;
    }
    const match = [' ' + line.slice(percentIndex)] as unknown as RegExpExecArray;
    match.index = contentEnd;
    match.input = line;
    return match;
  },
} as RegExp;

/** LaTeX's trailing-`%`-comment hard-break pattern -- `../../prose/dissolve-prose.ts`'s `ProseSpec.hardBreak`. */
export const LATEX_TRAILING_COMMENT_HARD_BREAK: readonly RegExp[] = [LATEX_TRAILING_COMMENT];
