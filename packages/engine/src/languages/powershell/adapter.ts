import type { LanguageAdapter } from '../../types/adapter.js';
import type { RegionKind } from '../../types/region.js';
import type { SyntaxNode } from '../../types/tree-sitter-types.js';
import { commentBasedHelpDialect } from '../../docs/comment-based-help.js';
import { powershellDescriptor } from './descriptor.js';

const BLOCK_OPEN = '<#';
const BLOCK_CLOSE = '#>';

/**
 * PowerShell's `classify` override.
 *
 * `comment` nodes need telling apart by text, the same shape every
 * lumped-single-node-type language in this package already uses
 * (`classifyEcmaScriptNode`, `cppAdapter`), but with one genuinely new
 * wrinkle: a `<# ... #>` block is `'docComment'` only when its *content*
 * (not its delimiter — both plain and comment-based-help blocks open
 * with the identical `<#`) looks like PowerShell's comment-based-help
 * convention. Reusing `commentBasedHelpDialect.detect` directly — rather
 * than a second, hand-duplicated tag-matching regex here — is
 * deliberate: "does this look like comment-based help" is exactly the
 * question that dialect's own `detect` already answers (used elsewhere
 * for `WrapConfig.docDialect: 'auto'` dialect selection), and there is no
 * fixed literal marker prefix the way every earlier `doc.markers` check
 * (`/**`, `\tag`/`@tag`) has that could substitute for it — see
 * `../../types/doc-dialect.ts`'s own doc comment on `'commentBasedHelp'`
 * for why. A `detect` score of exactly `0` means "not comment-based
 * help," matching every other dialect's own "no recognized tag lines
 * found" contract.
 */
function classify(node: SyntaxNode): RegionKind | null {
  if (node.type !== 'comment') {
    // Defensive: `powershellDescriptor.queries.comments` only ever
    // captures `comment` nodes.
    return null;
  }

  const text = node.text;
  if (text.startsWith(BLOCK_OPEN)) {
    const inner = text.slice(
      BLOCK_OPEN.length,
      text.endsWith(BLOCK_CLOSE) ? text.length - BLOCK_CLOSE.length : text.length,
    );
    return commentBasedHelpDialect.detect(inner) > 0 ? 'docComment' : 'blockComment';
  }
  return 'lineComment';
}

/**
 * PowerShell's `LanguageAdapter`.
 *
 * `classify` tells `'lineComment'`/`'blockComment'`/`'docComment'` apart
 * by text — see its own doc comment above. No `groupRegions`: adjacent
 * `#` comments aren't merged, the same open question left for every
 * other line-comment adapter in this package, and PowerShell has no
 * `///`-repeated-marker form needing the adjacency merge C++'s own
 * `groupRegions` exists for.
 *
 * No `strings`/`queries.strings` declared at all — deliberately out of
 * scope for this pass, not an oversight. `docs/language-candidates.md`'s
 * Pass 3 findings for PowerShell: `"..."` is interpolated (`$var`/
 * `$($expr)` — the same deferred-shape problem as every other language's
 * string interpolation in this project, doubly so since `$(...)`
 * subexpression syntax is richer than JS's `${}`), `'...'` is fully raw
 * and would fit `QuoteSpec` cleanly on its own, and here-strings
 * (`@"..."@`/`@'...'@`) were flagged as *plausibly* fitting
 * `RawFormSpec`'s fixed-delimiter shape but never verified against the
 * actual grammar node shape in that investigation — attempting partial
 * string support without that verification would risk exactly the kind
 * of "confirmed against the grammar" gap this project's own "probe
 * before coding" rule exists to catch. Comment-only is the honest,
 * fully-verified feature for this pass.
 */
export const powershellAdapter: LanguageAdapter = {
  descriptor: powershellDescriptor,
  classify,
};
