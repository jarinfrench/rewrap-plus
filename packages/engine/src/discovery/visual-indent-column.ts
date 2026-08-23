/**
 * Visual column (0-based) of the `column`-th UTF-16 code unit into
 * `lineText`, with tabs expanded to the next `tabSize` stop.
 *
 * This is what `WrappableRegion.indentColumn` promises ("visual column of
 * the region's start, with tabs expanded"). Region discovery is the first
 * place that needs a value for it, but the *correct* `tabSize` — the
 * editor's actual setting — only exists once `WrapConfig` is threaded
 * through the pipeline the extension builds in Phase 7. Until then,
 * `discoverRegions` (`./discover-regions.ts`) accepts an optional
 * `tabSize` and defaults it to 4, which is enough to make `indentColumn`
 * meaningful for this phase's fixtures and tests without inventing a
 * config-threading mechanism early.
 */
export function visualIndentColumn(lineText: string, column: number, tabSize: number): number {
  let visual = 0;
  const limit = Math.min(column, lineText.length);
  for (let i = 0; i < limit; i++) {
    visual = lineText[i] === '\t' ? visual + (tabSize - (visual % tabSize)) : visual + 1;
  }
  return visual;
}
