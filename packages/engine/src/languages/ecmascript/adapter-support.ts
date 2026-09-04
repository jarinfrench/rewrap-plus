import type { LanguageDescriptor } from '../../types/adapter.js';
import type { WrapConfig } from '../../types/config.js';
import type { RegionKind, WrappableRegion } from '../../types/region.js';
import type { SyntaxNode } from '../../types/tree-sitter-types.js';
import { sliceSpanText } from '../../discovery/slice-span.js';
import { wrapStringDefault } from '../../strings/wrap-string-default.js';

/**
 * Shared `LanguageAdapter` logic for every ECMAScript-family grammar
 * (`../javascript/`, `../typescript/`) — JavaScript, TypeScript, and TSX
 * all share the *identical* comment/string/concatenation shape (probed
 * directly against each vendored grammar: one `comment` node type for
 * `//`/`/* * /`/`/** * /` alike, a `string` node with no prefix
 * complexity, a `binary_expression` with `left`/`operator`/`right`
 * fields for `+`-concatenation — see `docs/adapters.md`'s
 * JavaScript/TypeScript/TSX — full adapters section and
 * `docs/parsing.md`'s Finding 5). Factored out here rather than
 * duplicated three times (JavaScript, TypeScript, TSX each needing their
 * own copy of otherwise-identical logic) or duplicated from scratch per
 * adapter — the same "promote once more than one real consumer needs it"
 * call this project already made for `comments/dissolve-line-comments.ts`
 * (promoted when the JavaScript canary adapter first needed it) and
 * `strings/dissolve-string.ts` (promoted out of `languages/python/` here,
 * once TypeScript and TSX needed the same logic JavaScript already had).
 *
 * What's genuinely *not* shared, and stays in each adapter's own module:
 * the `LanguageDescriptor` itself (grammar path, `id`, `aliases`) and the
 * `LanguageAdapter` object wiring these functions together — a
 * descriptor is still one per registered language id, per this project's
 * "adapter is data first" rule.
 */

/**
 * Classify a captured `comment`/`string` node — shared across every
 * ECMAScript-family adapter.
 *
 * - `string` nodes are always `'stringLiteral'` — no docstring concept in
 *   any of these languages.
 * - `//` line comments are `'lineComment'`.
 * - A comment starting with any of `descriptor.comments.doc`'s configured
 *   markers (`'/**'` for every current ECMAScript-family descriptor) is
 *   `'docComment'` — JSDoc-shaped, eligible for dialect-aware wrapping
 *   (`../../comments/wrap-doc-comment.ts`) via the `jsdoc` dialect once
 *   `wrap.ts` dispatches it. Checked against *every* configured marker,
 *   not just the first — the same posture `../cpp/adapter.ts`'s own
 *   `classify` already takes for its two Doxygen markers (`/**`/`///`);
 *   every current ECMAScript-family descriptor happens to declare only
 *   one, so this was previously equivalent in practice, but a
 *   `markers[0]`-only check would have silently stopped recognizing a
 *   second marker the moment one was ever added.
 * - A plain `/* ... * /` comment (single-star, no JSDoc marker) is
 *   `'blockComment'` when the descriptor declares `comments.plainBlock`
 *   (every real ECMAScript-family descriptor does — see
 *   `../javascript/descriptor.ts`), dissolved/emitted through that
 *   distinct open delimiter rather than `comments.block`'s JSDoc-marked
 *   one (`wrap.ts`'s `emitWrappedBlockComment`). Checked *after* the doc
 *   marker above, since `/**` also starts with `/*` — a descriptor with
 *   no `plainBlock` excludes a plain block comment from discovery
 *   entirely (`null`), the same "bias toward verbatim/skip when
 *   uncertain" default every earlier version of this function used.
 */
export function classifyEcmaScriptNode(
  node: SyntaxNode,
  descriptor: LanguageDescriptor,
): RegionKind | null {
  if (node.type === 'string') {
    return 'stringLiteral';
  }
  if (node.type !== 'comment') {
    // Defensive: every ECMAScript-family descriptor's queries only ever
    // capture `comment` and `string` nodes.
    return null;
  }

  const text = node.text;
  if (text.startsWith('//')) {
    return 'lineComment';
  }

  const docMarkers = descriptor.comments.doc?.markers ?? [];
  if (docMarkers.some((marker) => text.startsWith(marker))) {
    return 'docComment';
  }

  const plainBlock = descriptor.comments.plainBlock;
  if (plainBlock !== undefined && text.startsWith(plainBlock.open)) {
    return 'blockComment';
  }

  return null;
}

const LINE_CONTINUATION = /\\\r?\n/;
const IRREGULAR_WHITESPACE = /\t| {2}/;

/**
 * `isSafeToWrap` shared across every ECMAScript-family adapter: refuses a
 * `'stringLiteral'` containing a line-continuation escape or irregular
 * (tab/multi-space) whitespace, for the identical reason Python's own
 * `isSafeToWrap` refuses them (`../python/adapter.ts`'s own doc comment)
 * — `atomizeWords`/`reflowBlock` are prose-reflow machinery that would
 * otherwise silently change a string's real value, not just its
 * formatting. JavaScript/TypeScript strings support the exact same `\`
 * + real-newline line-continuation escape Python's do, so this refusal
 * transfers unchanged; there is no raw/byte/prefix concept to refuse
 * here the way Python's own version additionally checks.
 */
export function isEcmaScriptStringSafeToWrap(region: WrappableRegion, source: string): boolean {
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
 * `wrapString` shared across every ECMAScript-family adapter: the shared
 * `../../strings/wrap-string-default.ts` pipeline (dissolve, normalize
 * quote collisions, emit) with `needsParens` always `false` and `style`
 * always `'operator'` — unlike Python (`../python/emit-context.ts`),
 * splitting a `+`-concatenation run across new lines never needs its own
 * inserted grouping (`"a" + "b"` is valid wherever an expression is valid,
 * with no enclosing-bracket requirement the way Python's bare implicit-
 * concatenation juxtaposition has), and there is no second concatenation
 * style to resolve between, since every ECMAScript-family descriptor
 * declares only `'operator'`. Both axes are therefore fixed constants
 * rather than something a `tree` lookup ever needs to resolve, unlike
 * Python's version.
 */
export function wrapEcmaScriptString(
  region: WrappableRegion,
  source: string,
  cfg: WrapConfig,
): string {
  return wrapStringDefault(region, source, cfg, {
    needsParens: false,
    concatenationStyle: 'operator',
  });
}
