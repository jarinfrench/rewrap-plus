/**
 * Derive a `'prose'` region's canonical continuation prefix from its
 * first physical line's own container-marker text.
 *
 * `firstLinePrefix` is the literal source text on line 1 *before* the
 * paragraph's content starts (everything `discover-prose.ts` excluded
 * from `parts[0]`'s span) — a block-quote marker chain, a list marker
 * plus its hanging indent, or any combination the two nest in. Every
 * character in it that is not `>` or a tab is replaced with a space;
 * `>` and tab survive unchanged. This is the CommonMark-correct
 * continuation for every container combination the block grammar
 * produces, computed without walking container ancestry, and is what
 * makes a wrap idempotent regardless of how the source's own
 * continuation lines happened to be prefixed (§3.3 item 1: "continuation
 * prefix is canonical, not observed").
 *
 * Examples (from the plan's own table, each one a distinct container
 * shape, verified as a table-driven test in `./continuation-prefix.test.ts`):
 *
 * | first line   | continuation prefix |
 * |--------------|----------------------|
 * | `- text`     | `'  '`               |
 * | `1. text`    | `'   '`              |
 * | `- [ ] text` | `'      '`           |
 * | `> text`     | `'> '`               |
 * | `>> text`    | `'>> '`              |
 * | `- > text`   | `'  > '`             |
 * | `> - text`   | `'>   '`             |
 *
 * Tabs are kept as literal tab characters, not expanded — the same
 * approximation `../../prose/emit-prose.ts` already documents for the
 * rare case a container prefix contains one: `displayWidth` (used to
 * budget continuation lines, indirectly, through `WrappableRegion.indentColumn`)
 * doesn't expand tabs the way `indentColumn`'s own `visualIndentColumn`-based
 * computation does, so the two can diverge slightly for a tab-indented
 * container. Exact for the overwhelming common case (space-only
 * indentation), never depended on for correctness.
 */
export function markdownContinuationPrefix(firstLinePrefix: string): string {
  return Array.from(firstLinePrefix, (ch) => (ch === '>' || ch === '\t' ? ch : ' ')).join('');
}
