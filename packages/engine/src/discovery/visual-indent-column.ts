/**
 * Visual column (0-based) of the `column`-th UTF-16 code unit into
 * `lineText`, with tabs expanded to the next `tabSize` stop.
 *
 * This is what `WrappableRegion.indentColumn` promises ("visual column of
 * the region's start, with tabs expanded"). Region discovery is the first
 * place that needs a value for it, but the *correct* `tabSize` -- the
 * editor's actual setting -- only exists once a caller threads a real
 * `WrapConfig` through (as `../wrap.ts` does). `discoverRegions`
 * (`./discover-regions.ts`) itself accepts an optional `tabSize` and
 * defaults it to 4, which keeps `indentColumn` meaningful for callers --
 * such as this module's own fixtures and tests -- that build regions
 * directly, without requiring a full `WrapConfig`.
 */
export function visualIndentColumn(lineText: string, column: number, tabSize: number): number {
  let visual = 0;
  const limit = Math.min(column, lineText.length);
  for (let i = 0; i < limit; i++) {
    visual = lineText[i] === '\t' ? visual + (tabSize - (visual % tabSize)) : visual + 1;
  }
  return visual;
}
