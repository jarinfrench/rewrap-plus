import type { LanguageAdapter } from '../../types/adapter.js';
import type { RegionKind } from '../../types/region.js';
import type { SyntaxNode } from '../../types/tree-sitter-types.js';
import { javaDescriptor } from './descriptor.js';
import { wrapJavaString } from './wrap-string.js';

const TEXT_BLOCK_DELIMITER = '"""';

/**
 * Java's `classify` override.
 *
 * `string_literal` nodes are `'stringLiteral'` **unless** the node's own
 * text starts with `"""` — a text block, sharing this node type with an
 * ordinary string (see `./descriptor.ts`'s own doc comment for why) —
 * which is excluded from discovery entirely (`null`), the same "bias
 * toward verbatim/skip when uncertain" default `classifyEcmaScriptNode`
 * already uses for a plain block comment with no `plainBlock` declared.
 * Deliberate scope limit, not an oversight: a text block's own
 * common-indentation-stripping and trailing-newline rules have no
 * representation in this project's existing dissolve model — see
 * `./descriptor.ts`'s own doc comment for the full reasoning.
 *
 * `line_comment`/`block_comment` nodes need telling apart by *type*
 * first, then a `block_comment`'s own text by its delimiter — the
 * reverse order `classifyEcmaScriptNode`/`cppAdapter`'s own `classify`
 * use, since those grammars only ever produce one comment node type to
 * begin with:
 *
 * - `line_comment` is always `'lineComment'`.
 * - A `block_comment` starting with `/**` is `'docComment'`, eligible for
 *   dialect-aware wrapping via the `javadoc` dialect (`../../docs/javadoc.ts`).
 * - Any other `block_comment` (a plain `/* ... * /`, no Javadoc marker)
 *   is `'blockComment'`, dissolved/emitted through `comments.plainBlock`'s
 *   distinct open delimiter rather than `comments.block`'s Javadoc-marked
 *   one.
 */
function classify(node: SyntaxNode): RegionKind | null {
  if (node.type === 'string_literal') {
    return node.text.startsWith(TEXT_BLOCK_DELIMITER) ? null : 'stringLiteral';
  }
  if (node.type === 'line_comment') {
    return 'lineComment';
  }
  if (node.type !== 'block_comment') {
    // Defensive: `javaDescriptor.queries` only ever captures
    // `line_comment`, `block_comment`, and `string_literal` nodes.
    return null;
  }

  const text = node.text;
  const docMarkers = javaDescriptor.comments.doc?.markers ?? [];
  if (docMarkers.some((marker) => text.startsWith(marker))) {
    return 'docComment';
  }
  const plainBlock = javaDescriptor.comments.plainBlock;
  if (plainBlock !== undefined && text.startsWith(plainBlock.open)) {
    return 'blockComment';
  }
  return null;
}

/**
 * Java's `LanguageAdapter`.
 *
 * `classify` tells `'lineComment'`/`'blockComment'`/`'docComment'`/
 * `'stringLiteral'` apart by node type and text, excluding text blocks
 * entirely (see `classify`'s own doc comment). No `groupRegions`
 * override: Java's `//` comments aren't merged across adjacent lines the
 * way Python's are, the same open question left for JavaScript/
 * TypeScript's and C++'s own ordinary `//` comments too
 * (`docs/adapters.md`) — and Java has no `///`-repeated doc-comment form
 * needing the merge C++'s own `groupRegions` exists for. No `isSafeToWrap`
 * override: Java string literals have no prefix concept at all
 * (`javaDescriptor.strings.prefixes` is empty) and no other Java-specific
 * hazard beyond what `../../wrap.ts`'s own unconditional baseline already
 * refuses for every `'stringLiteral'` region regardless of adapter (line-
 * continuation escapes, irregular whitespace — see
 * `../../strings/is-string-safe-to-wrap-baseline.ts`), so there is nothing
 * left for a Java-specific hook to add; omitting it entirely (rather than
 * declaring a hook that always returns `true`) is exactly what
 * `LanguageAdapter.isSafeToWrap`'s own doc comment describes as "no
 * further refusals beyond the baseline." `wrapString` is Java's whole
 * `'stringLiteral'` pipeline — see `./wrap-string.ts` for why it needs no
 * `emitContext`-shaped resolution the way Python's own does. No
 * `wrapDocstring`: Java has no string-literal-as-documentation
 * convention.
 */
export const javaAdapter: LanguageAdapter = {
  descriptor: javaDescriptor,
  classify,
  wrapString: wrapJavaString,
};
