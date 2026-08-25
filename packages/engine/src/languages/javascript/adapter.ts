import type { LanguageAdapter } from '../../types/adapter.js';
import type { RegionKind } from '../../types/region.js';
import type { SyntaxNode } from '../../types/tree-sitter-types.js';
import { javascriptDescriptor } from './descriptor.js';

/**
 * JavaScript's `classify` override.
 *
 * Handles both node types the descriptor's queries ever hand it, same
 * contract as Python's `classify` (see that function's own doc comment
 * on why a hook that's defined at all is expected to handle every node
 * type its queries can produce):
 *
 * - `string` nodes are always `'stringLiteral'` — no docstring concept
 *   in JavaScript, and no dissolve/emit support for strings in this
 *   canary at all (`./descriptor.ts`'s own doc comment).
 * - `comment` nodes need the real work. Unlike Python — where the
 *   `comment` query only ever captures line comments, so
 *   `discoverRegions`'s own `'lineComment'` fallback is already correct
 *   without an override — JavaScript's grammar uses one `comment` node
 *   type for `//`, plain `/* * /`, and `/** * /` alike (verified by
 *   probing the vendored grammar; see `./descriptor.ts`'s own doc
 *   comment). Telling them apart is exactly what this hook is for:
 *   distinguish by the captured node's own text, since the grammar
 *   gives no other signal.
 *
 * A block-shaped comment is only ever classified `'blockComment'` when
 * it starts with this descriptor's exact configured
 * `comments.block.open` (`'/**'`) — a plain single-star `/* * /`
 * comment does *not* match and is excluded from discovery entirely
 * (`null`) rather than dissolved through a delimiter pair it doesn't
 * actually use. This is a deliberate, documented scope limit for a
 * "deliberately thin... a probe, not a feature" canary (Phase 6b's own
 * framing), not an oversight: `dissolveBlockComments` strips exactly
 * `block.open` from the start of a region's text, so feeding it a
 * comment that opens with only one `*` would either silently produce
 * wrong output or throw partway through — and "bias toward
 * verbatim/skip when uncertain" (Phase 4's own stated principle,
 * applied here to a case Phase 4 didn't anticipate) is squarely the
 * right call over guessing. A real (non-canary) JavaScript adapter
 * — Phase 12b — should decide deliberately whether to unify the two
 * forms rather than inheriting this shortcut by default.
 */
function classify(node: SyntaxNode): RegionKind | null {
  if (node.type === 'string') {
    // No docstring concept in JavaScript and no dissolve/emit support
    // for strings in this canary (see `./descriptor.ts`'s own doc
    // comment) — every captured string is an ordinary `'stringLiteral'`,
    // same as `discoverRegions`'s own fallback would assign if this
    // hook didn't handle string nodes at all. Named explicitly anyway,
    // for the same reason Python's `classify` does: a hook that's
    // defined at all is expected to handle every node type its queries
    // can produce, not silently fall through for some of them.
    return 'stringLiteral';
  }

  if (node.type !== 'comment') {
    // Defensive: `javascriptDescriptor.queries` only ever captures
    // `comment` and `string` nodes, mirroring Python's adapter — see
    // that function's own doc comment on why this is unreachable in
    // practice but still worth guarding.
    return null;
  }

  const text = node.text;
  if (text.startsWith('//')) {
    return 'lineComment';
  }

  const blockOpen = javascriptDescriptor.comments.block?.open;
  if (blockOpen !== undefined && text.startsWith(blockOpen)) {
    return 'blockComment';
  }

  return null;
}

/**
 * JavaScript's `LanguageAdapter` — Phase 6b's canary.
 *
 * `classify` is the only hook this adapter overrides: no
 * `groupRegions` (JavaScript's `//` comments aren't merged across
 * adjacent lines the way Python's are — left as a genuine open question
 * for Phase 12b, not answered here), no `isSafeToWrap` (nothing about
 * comment-only wrapping needs a language-specific safety check the way
 * Python's raw/byte-string prefixes did), no `emitContext` (no string
 * wrapping to need paren-insertion context for). A descriptor plus one
 * small hook is exactly the "adding a language is cheap" shape the
 * whole adapter interface exists to enable.
 */
export const javascriptAdapter: LanguageAdapter = {
  descriptor: javascriptDescriptor,
  classify,
};
