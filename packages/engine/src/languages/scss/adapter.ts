import type { LanguageAdapter } from '../../types/adapter.js';
import type { RegionKind } from '../../types/region.js';
import type { SyntaxNode } from '../../types/tree-sitter-types.js';
import { scssDescriptor } from './descriptor.js';

/**
 * SCSS's `classify` override.
 *
 * Unlike Java's `block_comment` (which needs its own text sniffed to
 * tell a plain `/* * /` from a Javadoc `/** * /`), neither of SCSS's two
 * node types is ever ambiguous on its own -- `js_comment` is always
 * `'lineComment'`, `comment` is always `'blockComment'` -- so this is a
 * pure node-type switch, no text inspection at all. See `./descriptor.ts`'s
 * own doc comment for the grammar probe this relies on.
 */
function classify(node: SyntaxNode): RegionKind | null {
  if (node.type === 'js_comment') {
    return 'lineComment';
  }
  if (node.type === 'comment') {
    return 'blockComment';
  }
  // Defensive: `scssDescriptor.queries.comments` only ever captures these
  // two node types.
  return null;
}

/**
 * SCSS's `LanguageAdapter`.
 *
 * `classify` tells `js_comment`/`comment` apart by node type alone -- see
 * its own doc comment above. No `groupRegions`: neither comment form is
 * merged across adjacent lines, the same open question left for every
 * other line/block-comment adapter in this package. No `strings`/
 * `queries.strings`: `scssDescriptor` omits them entirely, matching
 * `../css/descriptor.ts`'s own reasoning verbatim -- SCSS's value syntax
 * has the identical shape.
 */
export const scssAdapter: LanguageAdapter = {
  descriptor: scssDescriptor,
  classify,
};
