import type { LanguageAdapter } from '../../types/adapter.js';
import type { RegionKind, WrappableRegion } from '../../types/region.js';
import type { SyntaxNode } from '../../types/tree-sitter-types.js';
import { sliceSpanText } from '../../discovery/slice-span.js';
import { groupAdjacentRegions } from '../../comments/group-adjacent-regions.js';
import { cppDescriptor } from './descriptor.js';
import { extractPrefix } from './prefix.js';
import { wrapCppString } from './wrap-string.js';

/**
 * C++'s `classify` override.
 *
 * `string_literal` nodes are always `'stringLiteral'` — C++ has no
 * docstring concept (`raw_string_literal`/`char_literal` are separate
 * node types `cppDescriptor.queries.strings` never captures in the first
 * place, per `./descriptor.ts`'s own doc comment, so this never needs to
 * tell them apart from an ordinary string here).
 *
 * `comment` nodes need telling apart by text, the same shape every
 * ECMAScript-family adapter's `classifyEcmaScriptNode` already handles
 * (`../ecmascript/adapter-support.ts`) — one grammar node type covers
 * `//`, `///`, plain `/* * /`, and `/** * /` alike:
 *
 * - `/**` and `///` are both `'docComment'` (`cppDescriptor.comments.doc.markers`
 *   lists both), eligible for dialect-aware wrapping via the `doxygen`
 *   dialect (`../../docs/doxygen.ts`) — checked against *every* configured
 *   marker, not just the first, and before the plain `//` check below,
 *   since `///` also starts with `//`. `wrapDocComment`
 *   (`../../comments/wrap-doc-comment.ts`) tells the two delimiter
 *   *shapes* apart at wrap time (`comments.doc.repeatedMarker`): `/**`
 *   dissolves/emits through `comments.block`'s open/close pair, `///`
 *   through the same per-line machinery a `'lineComment'` region uses.
 * - A plain `/* ... * /` (no `///`, no `/**`) is `'blockComment'`,
 *   dissolved/emitted through `comments.plainBlock`'s distinct open
 *   delimiter rather than `comments.block`'s Doxygen-marked one.
 * - Everything else starting with `//` (ordinary, non-`///`) is
 *   `'lineComment'`.
 */
function classify(node: SyntaxNode): RegionKind | null {
  if (node.type === 'string_literal') {
    return 'stringLiteral';
  }
  if (node.type !== 'comment') {
    // Defensive: `cppDescriptor.queries` only ever captures `comment` and
    // `string_literal` nodes.
    return null;
  }

  const text = node.text;
  const docMarkers = cppDescriptor.comments.doc?.markers ?? [];
  if (docMarkers.some((marker) => text.startsWith(marker))) {
    return 'docComment';
  }
  if (text.startsWith('//')) {
    return 'lineComment';
  }
  const plainBlock = cppDescriptor.comments.plainBlock;
  if (plainBlock !== undefined && text.startsWith(plainBlock.open)) {
    return 'blockComment';
  }
  return null;
}

/**
 * C++'s `groupRegions` override: merges consecutive `///` (Doxygen
 * repeated-marker) `'docComment'` regions at the same indent column into
 * a single multi-part region — the identical adjacency merge Python's
 * own `'lineComment'` grouping uses
 * (`../../comments/group-adjacent-regions.ts`'s `groupAdjacentRegions`),
 * applied to a different `RegionKind`/predicate pair. Deliberately
 * excludes `/** ... * /`-form `'docComment'` regions
 * (`!region.rawText.startsWith('///')`): each is already one complete
 * node needing no merge, and merging two genuinely separate adjacent
 * block doc comments would corrupt the span
 * `dissolveBlockCommentText`/`emitBlockComments` expect (one open
 * delimiter, one close delimiter — not two of each inside one region).
 * Ordinary `//` line comments are still never merged for C++, the same
 * open question left for JavaScript/TypeScript's own `//` comments too
 * (`docs/adapters.md`).
 */
function groupRegions(regions: readonly WrappableRegion[]): WrappableRegion[] {
  return groupAdjacentRegions(
    regions,
    (region) => region.kind === 'docComment' && region.rawText.startsWith('///'),
  );
}

/**
 * C++'s `isSafeToWrap` override.
 *
 * Only `'stringLiteral'` regions are ever flagged unsafe here; every
 * other kind (including `'lineComment'`/`'docComment'`, whose
 * `neverReflow` directive patterns are `wrapRegions`'s own concern, not
 * this hook's) always returns `true`.
 *
 * A line-continuation escape or irregular (tab/multi-space) whitespace in
 * any part is refused too, but not by this function — `../../wrap.ts`
 * applies that check unconditionally, for every `'stringLiteral'` region,
 * before ever reaching this hook (see
 * `../../strings/is-string-safe-to-wrap-baseline.ts`) — an engine-level
 * baseline, not a C++-specific rule. What's left here is genuinely
 * C++-specific:
 *
 * - **Any part's prefix doesn't parse** (`extractPrefix` returning
 *   `null`) — reachable in principle for a hand-built `WrappableRegion`
 *   that doesn't correspond to real discovered output; "assume unsafe" is
 *   the failure mode that can't corrupt a file, the same posture Python's
 *   own `isSafeToWrap` takes for the identical case.
 * - **The concatenation run mixes more than one distinct prefix** —
 *   including an empty prefix alongside a real one (`"abc" L"def"`,
 *   perfectly valid, standards-legal C++: an unprefixed literal adjacent
 *   to a prefixed one takes on that prefix). Refusing this anyway,
 *   exactly mirroring Python's own strictness (`../python/adapter.ts`'s
 *   `isSafeToWrap`: "distinctNormalized.size > 1" refuses *any* prefix
 *   mismatch, not just a same-flavor conflict), is a deliberate,
 *   conservative choice forced by a real correctness constraint:
 *   `./dissolve-string.ts`'s shared `dissolveString` always reuses the
 *   *first* part's own prefix as the sole representative for every
 *   emitted line (`../../strings/dissolve-string.ts`'s own doc comment,
 *   "Representative prefix/quote choice") — merging `"abc" L"def"` would
 *   silently drop the `L` the moment the first (unprefixed) part's own
 *   prefix was chosen to represent the whole run, a real value change on
 *   some compilers/platforms (a narrow vs. wide string), not merely
 *   cosmetic. Refusing any mismatch at all sidesteps needing new
 *   representative-prefix-selection logic in shared emit code that no
 *   other adapter needs.
 */
function isSafeToWrap(region: WrappableRegion, source: string): boolean {
  if (region.kind !== 'stringLiteral') {
    return true;
  }

  const partTexts = region.parts.map((part) => sliceSpanText(source, part));

  const prefixes = partTexts.map((text) => extractPrefix(text));
  if (prefixes.some((prefix) => prefix === null)) {
    return false;
  }
  if (new Set(prefixes).size > 1) {
    return false; // mixed prefixes within one concatenation run — see doc comment above
  }

  return true;
}

/**
 * C++'s `LanguageAdapter`.
 *
 * `classify` tells `'lineComment'`/`'blockComment'`/`'docComment'`/
 * `'stringLiteral'` apart by node type and text — both `/**` and `///`
 * doc-comment forms are wrapped, via the `doxygen` dialect, as is a plain
 * `/* * /` block comment (see `classify`'s own doc comment). `groupRegions`
 * merges consecutive `///` lines at the same indent into one logical
 * block, the `///`-specific counterpart to Python's own `'lineComment'`
 * merging. `isSafeToWrap` flags mixed-prefix concatenation runs and
 * unparseable prefixes as unsafe to wrap, on top of the line-continuation/
 * irregular-whitespace baseline `../../wrap.ts` already applies to every
 * `'stringLiteral'` region regardless of adapter (see `isSafeToWrap`'s own
 * doc comment). `wrapString` is C++'s whole `'stringLiteral'` pipeline — see
 * `./wrap-string.ts` for why it needs no `emitContext`-shaped resolution
 * the way Python's own does.
 */
export const cppAdapter: LanguageAdapter = {
  descriptor: cppDescriptor,
  classify,
  groupRegions,
  isSafeToWrap,
  wrapString: wrapCppString,
};
