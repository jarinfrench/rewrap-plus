import type { EmitContext, LanguageAdapter } from '../../types/adapter.js';
import type { RegionKind, WrappableRegion } from '../../types/region.js';
import type { SyntaxNode } from '../../types/tree-sitter-types.js';
import { sliceSpanText } from '../../discovery/slice-span.js';
import { dissolveString } from '../../strings/dissolve-string.js';
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
 * - `///` is excluded from discovery entirely (`null`) — a **deliberate
 *   scope limit**, not an oversight. Doxygen's repeated-line-marker style
 *   is a genuinely different delimiter *shape* than `/** ... * /` (no
 *   single open/close pair `dissolveBlockCommentText`/`emitBlockComments`
 *   can express — those two functions, and therefore `wrapDocComment`,
 *   are built entirely around one open delimiter, one close delimiter,
 *   and an optional per-line continuation marker in between; merging
 *   consecutive `///` lines into a region and running them through that
 *   machinery unchanged would silently rewrite the user's chosen `///`
 *   style into `/** * /` on emit, or fail to strip the marker at all,
 *   since neither `block.open`/`block.close` nor `block.continuationPrefix`
 *   matches `///` text). Building genuine `///` support is real,
 *   separate engine work (a repeated-marker dissolve/emit pair alongside
 *   the existing open/close one) that nothing in this phase's plan text
 *   demands — see `docs/adapters.md`'s Phase 12c section for the full
 *   reasoning. "Bias toward verbatim/skip when uncertain" (Phase 4's own
 *   principle), applied here exactly as Phase 12b already applied it to
 *   plain `/* * /`.
 * - `/**` is `'docComment'` — Doxygen-shaped, eligible for dialect-aware
 *   wrapping via the `doxygen` dialect (`../../docs/doxygen.ts`).
 * - A plain `/* ... * /` (no `///`, no `/**`) is excluded from discovery
 *   too, the same choice every earlier phase's descriptor already made
 *   for the identical reason (`comments.block` is one delimiter shape,
 *   already spoken for by the Doxygen `/**`/`*`-continuation form).
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
  if (text.startsWith('///')) {
    return null;
  }
  if (text.startsWith('//')) {
    return 'lineComment';
  }
  if (text.startsWith(cppDescriptor.comments.doc!.markers[0]!)) {
    return 'docComment';
  }
  return null;
}

const LINE_CONTINUATION = /\\\r?\n/;
const IRREGULAR_WHITESPACE = /\t| {2}/;

/**
 * C++'s `isSafeToWrap` override.
 *
 * Only `'stringLiteral'` regions are ever flagged unsafe here; every
 * other kind (including `'lineComment'`/`'docComment'`, whose
 * `neverReflow` directive patterns are `wrapRegions`'s own concern, not
 * this hook's) always returns `true`.
 *
 * A string-shaped region is unsafe when:
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
 * - **Contains a line-continuation escape** (`\` immediately followed by
 *   a real newline) — the identical refusal, and identical rationale,
 *   Python's and every ECMAScript-family adapter's `isSafeToWrap` already
 *   apply: `dissolveString`'s "never decode, just concatenate bodies
 *   verbatim" design has no way to represent a body that still contains
 *   an actual embedded line break.
 * - **Contains a tab, or a run of two or more consecutive spaces** — the
 *   identical refusal every other adapter's string-wrapping
 *   `isSafeToWrap` already applies, for the identical reason
 *   (`atomizeWords` collapses any whitespace run to one rendered space,
 *   which would silently change such a string's real value).
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

  if (partTexts.some((text) => LINE_CONTINUATION.test(text))) {
    return false;
  }
  if (partTexts.some((text) => IRREGULAR_WHITESPACE.test(text))) {
    return false;
  }

  return true;
}

/**
 * C++'s `emitContext`: always "no parens, bare-adjacency style" — see
 * `./descriptor.ts`'s own doc comment for why C++ has no second
 * concatenation style to resolve between and no grouping construct ever
 * needs inserting. `region`/`tree`/`cfg` are accepted only to match
 * `LanguageAdapter.emitContext`'s signature; none is consulted, the same
 * shape as `../ecmascript/adapter-support.ts`'s `ecmaScriptEmitContext`.
 */
function emitContext(): EmitContext {
  return { needsParens: false, concatenationStyle: 'implicit' as const };
}

/**
 * C++'s `proseText` override: the dissolved logical text (quote/prefix
 * stripped) rather than the raw source slice — the identical quote-
 * anchoring fix Python's and every ECMAScript-family adapter's own
 * `proseText` override exists for (`../../types/adapter.ts`'s own doc
 * comment on why the raw-text default is wrong for any quote-delimited
 * string syntax).
 */
function proseText(region: WrappableRegion, source: string): string {
  return dissolveString(region, source).text;
}

/**
 * C++'s `LanguageAdapter` (Phase 12c).
 *
 * `classify` tells `'lineComment'`/`'docComment'`/`'stringLiteral'` apart
 * by node type and text, and excludes `///` and plain `/* * /` comments
 * from discovery entirely (deliberate scope limits — see `classify`'s own
 * doc comment). `isSafeToWrap` flags mixed-prefix concatenation runs,
 * line-continuation escapes, and irregular whitespace as unsafe to wrap.
 * No `groupRegions` override: neither consecutive `//` lines nor `///`
 * runs are merged into a single logical block, the same open question
 * Phase 6b/12b already deferred for JavaScript/TypeScript's own `//`
 * comments (`docs/adapters.md`). `emitContext`/`wrapString` are C++'s
 * whole `'stringLiteral'` pipeline, the same shape every adapter with
 * string support uses.
 */
export const cppAdapter: LanguageAdapter = {
  descriptor: cppDescriptor,
  classify,
  isSafeToWrap,
  proseText,
  emitContext,
  wrapString: wrapCppString,
};
