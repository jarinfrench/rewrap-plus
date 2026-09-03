/**
 * LaTeX's hard-break detection — `docs/planning/markdown-latex-plan.md`
 * §4.2/§6.5, adapted from Rewrap's own pattern. Unlike Markdown's
 * trailing-backslash form (`../markdown/hard-break.ts`), which needs
 * parity-counting to tell an escaped backslash from a real break, LaTeX's
 * forms are all fixed, unambiguous command tokens — `\\` (LaTeX's own
 * line-break command, confirmed by direct probing to parse as a
 * `generic_command` whose text is the literal two-character string `\\`,
 * `docs/parsing.md` Finding 8) optionally starred (`\\*`), `\newline`,
 * `\linebreak`, `\break`, and `\hline` (a tabular row separator, included
 * because Rewrap's own list includes it, even though it's unlikely inside
 * an ordinary prose paragraph specifically) — each optionally followed by
 * a `[...]`/`{...}` argument (`\\[10pt]`, `\linebreak[4]`). No parity
 * concern, so a single anchored regex suffices, unlike Markdown's
 * `RegExp`-shaped wrapper object.
 */
const LATEX_HARD_BREAK_COMMAND = /\\(\\\*?|newline|linebreak|break|hline)(\[[^\]]*\])?(\{[^}]*\})?\s*$/;

/** LaTeX's `ProseSpec.hardBreak` — `../../prose/dissolve-prose.ts`. */
export const LATEX_HARD_BREAK: readonly RegExp[] = [LATEX_HARD_BREAK_COMMAND];
