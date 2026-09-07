/**
 * LaTeX's continuation-prefix rule: spaces to the region's first line's
 * indentation (not the content column). For an ordinary paragraph, a
 * region's own content-start column *is* its line's indentation
 * (`./discover-prose.ts` computes both the same way,
 * `firstNonWhitespaceColumn`), so the two coincide and this is a no-op
 * refinement. For a `\item` line, they diverge on purpose: the region's
 * own first `parts` entry starts *after* `\item`/`[label]`
 * (`./discover-prose.ts`'s `buildEnumItemStartColumns`), but a
 * continuation line should align under the `\item` marker itself, not
 * under where the item's own text happens to start -- "new lines match the
 * line above," Rewrap's own convention for this case.
 *
 * Much simpler than Markdown's `markdownContinuationPrefix`
 * (`../markdown/continuation-prefix.ts`): LaTeX has no block-quote-style
 * prefix character that needs preserving on continuation lines while
 * everything else is blanked out -- a `\item`'s hanging indent is *pure*
 * whitespace, so this only ever needs the first line's own literal
 * leading whitespace, verbatim (tabs included, matching Sec. 6.3's "keep the
 * first line's literal leading whitespace as the prefix").
 */
export function latexContinuationPrefix(firstLineText: string): string {
  const match = /^[ \t]*/.exec(firstLineText);
  return match ? match[0] : '';
}
