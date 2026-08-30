import type { EmitContext, LanguageAdapter } from '../../types/adapter.js';
import type { RegionKind, WrappableRegion } from '../../types/region.js';
import type { SyntaxNode } from '../../types/tree-sitter-types.js';
import { sliceSpanText } from '../../discovery/slice-span.js';
import { dissolveString } from '../../strings/dissolve-string.js';
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

const LINE_CONTINUATION = /\\\r?\n/;
const IRREGULAR_WHITESPACE = /\t| {2}/;

/**
 * Java's `isSafeToWrap` override.
 *
 * Only `'stringLiteral'` regions are ever flagged unsafe here — text
 * blocks never reach this point at all, since `classify` above excludes
 * them from discovery before `isSafeToWrap` is ever consulted, unlike
 * (say) a prefix mismatch, which is a genuine per-region safety check
 * rather than a blanket exclusion.
 *
 * A string-shaped region is unsafe when:
 *
 * - **Contains a line-continuation escape** (`\` immediately followed by
 *   a real newline) — the identical refusal, and identical rationale,
 *   every other adapter's `isSafeToWrap` already applies:
 *   `dissolveString`'s "never decode, just concatenate bodies verbatim"
 *   design has no way to represent a body that still contains an actual
 *   embedded line break. (Java string literals can't actually contain
 *   this — an ordinary `string_literal` is a parse error across a real
 *   newline — but the check costs nothing to keep and matches every
 *   sibling adapter's own defensive posture.)
 * - **Contains a tab, or a run of two or more consecutive spaces** — the
 *   identical refusal every other adapter's string-wrapping
 *   `isSafeToWrap` already applies, for the identical reason
 *   (`atomizeWords` collapses any whitespace run to one rendered space,
 *   which would silently change such a string's real value).
 *
 * No prefix-mismatch check the way C++'s own `isSafeToWrap` has — Java
 * string literals have no prefix concept at all (`javaDescriptor.strings.prefixes`
 * is empty), so there is nothing to mismatch.
 */
function isSafeToWrap(region: WrappableRegion, source: string): boolean {
  if (region.kind !== 'stringLiteral') {
    return true;
  }

  const partTexts = region.parts.map((part) => sliceSpanText(source, part));
  if (partTexts.some((text) => LINE_CONTINUATION.test(text))) {
    return false;
  }
  if (partTexts.some((text) => IRREGULAR_WHITESPACE.test(text))) {
    return false;
  }

  return true;
}

/**
 * Java's `emitContext`: always "no parens, operator style" — `"a" + "b"`
 * is valid wherever an expression already is, with no enclosing-bracket
 * requirement the way Python's bare implicit-concatenation juxtaposition
 * has, and there is no second concatenation style to resolve between,
 * since `javaDescriptor` declares only `'operator'`. `region`/`tree`/`cfg`
 * are accepted only to match `LanguageAdapter.emitContext`'s signature;
 * none is consulted — the identical shape
 * `../ecmascript/adapter-support.ts`'s `ecmaScriptEmitContext` and
 * `../cpp/adapter.ts`'s local `emitContext` both use.
 */
function emitContext(): EmitContext {
  return { needsParens: false, concatenationStyle: 'operator' as const };
}

/**
 * Java's `proseText` override: the dissolved logical text (quote
 * stripped) rather than the raw source slice — the identical
 * quote-anchoring fix every other quote-delimited-string adapter's own
 * `proseText` override exists for (`../../types/adapter.ts`'s own doc
 * comment on why the raw-text default is wrong for any quote-delimited
 * string syntax).
 */
function proseText(region: WrappableRegion, source: string): string {
  return dissolveString(region, source).text;
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
 * needing the merge C++'s own `groupRegions` exists for. `isSafeToWrap`
 * flags line-continuation escapes and irregular whitespace as unsafe to
 * wrap. `emitContext`/`wrapString` are Java's whole `'stringLiteral'`
 * pipeline, the same shape every adapter with string support uses. No
 * `wrapDocstring`: Java has no string-literal-as-documentation
 * convention.
 */
export const javaAdapter: LanguageAdapter = {
  descriptor: javaDescriptor,
  classify,
  isSafeToWrap,
  proseText,
  emitContext,
  wrapString: wrapJavaString,
};
