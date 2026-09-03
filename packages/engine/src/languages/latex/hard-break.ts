/**
 * LaTeX's hard-break detection — `docs/planning/markdown-latex-plan.md`
 * §4.2/§6.5, adapted from Rewrap's own pattern. Unlike Markdown's
 * trailing-backslash form (`../markdown/hard-break.ts`), which needs
 * parity-counting to tell an escaped backslash from a real break, LaTeX's
 * forms are all fixed, unambiguous command tokens — `\\` (LaTeX's own
 * line-break command, confirmed by direct probing to parse as a
 * `generic_command` whose text is the literal two-character string `\\`,
 * `docs/parsing.md` Finding 8) optionally starred (`\\*`), `\newline`,
 * `\linebreak`, `\break`, and `\hline` — each optionally followed by a
 * `[...]`/`{...}` argument (`\\[10pt]`, `\linebreak[4]`). No parity
 * concern, so a single anchored regex suffices, unlike Markdown's
 * `RegExp`-shaped wrapper object.
 *
 * **`\hline` — §6.2's own "decide and fixture it" item, resolved:**
 * `tabular` is in `discover-prose.ts`'s `MASKED_GENERIC_ENVIRONMENT_NAMES`
 * (a tabular's own content is preserved verbatim, never discovered as
 * prose at all), so a `\hline` in its ordinary, intended position — a
 * tabular row separator — never reaches this pattern in the first place;
 * the row it sits on is masked away before `discoverLatexProse` ever
 * builds a `'prose'` part for it, let alone before `dissolveProse` tries
 * matching a hard break against that part's text. Kept in this pattern
 * anyway, matching Rewrap's own list, for the one case where it *would*
 * matter: `\hline` written at the end of an ordinary prose line outside
 * any `tabular` (unusual, arguably a misuse, but not a parse error, and
 * masking `tabular` doesn't change what happens on such a line one way
 * or the other) — and so this stays correct without changes if
 * `tabular`'s own masking decision is ever revisited later.
 */
const LATEX_HARD_BREAK_COMMAND = /\\(\\\*?|newline|linebreak|break|hline)(\[[^\]]*\])?(\{[^}]*\})?\s*$/;

/** LaTeX's `ProseSpec.hardBreak` — `../../prose/dissolve-prose.ts`. */
export const LATEX_HARD_BREAK: readonly RegExp[] = [LATEX_HARD_BREAK_COMMAND];
