import type { LanguageAdapter } from '../../types/adapter.js';
import type { RegionKind } from '../../types/region.js';
import type { SyntaxNode } from '../../types/tree-sitter-types.js';
import { cssDescriptor } from './descriptor.js';

/**
 * CSS's `classify` override.
 *
 * Every `comment` node is `'blockComment'` -- CSS has exactly one comment
 * form (`/* ... * /`), no line-comment alternative and no doc-marked
 * variant, so there's nothing left for text-sniffing to distinguish (see
 * `./descriptor.ts`'s own doc comment for why `discoverRegions`'s default
 * `'lineComment'` fallback would be wrong here and this override exists
 * at all).
 */
function classify(node: SyntaxNode): RegionKind | null {
  return node.type === 'comment' ? 'blockComment' : null;
}

/**
 * CSS's `LanguageAdapter`.
 *
 * `classify` is CSS's only override -- see its own doc comment above. No
 * `groupRegions`: CSS comments aren't merged across adjacent lines, the
 * same open question left for every other block-comment adapter in this
 * package. No `strings`/`queries.strings` declared: `cssDescriptor` omits
 * them entirely, per `./descriptor.ts`'s own doc comment -- CSS has no
 * string-joining syntax (no concatenation operator, no interpolation),
 * and `docs/language-candidates.md`'s CSS row found no reason to attempt
 * string wrapping for a value language where "is this really prose"
 * rarely holds.
 */
export const cssAdapter: LanguageAdapter = {
  descriptor: cssDescriptor,
  classify,
};
