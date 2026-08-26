import type { LanguageAdapter } from '../../types/adapter.js';
import type { RegionKind, WrappableRegion } from '../../types/region.js';
import type { SyntaxNode, Tree } from '../../types/tree-sitter-types.js';
import type { WrapConfig } from '../../types/config.js';
import { sliceSpanText } from '../../discovery/slice-span.js';
import { pythonDescriptor } from './descriptor.js';
import { isAttributeDocstringPosition, isDocstringPosition } from './docstring-position.js';
import { classifyPrefix, extractPrefix } from './prefix.js';
import { wrapDocstring } from './wrap-docstring.js';
import { emitContext } from './emit-context.js';
import { wrapString } from './wrap-string.js';
import { dissolveString } from '../../strings/dissolve-string.js';
import { dissolveDocstring } from './dissolve-docstring.js';
import { isSingleTripleQuotedLiteral } from './triple-quote.js';
import { looksLikeProse } from '../../prose-heuristic.js';

/**
 * Python's `isProseEligible` override: `false` for a `'stringLiteral'`
 * that's a dictionary literal's own key (`emitContext`'s `isDictKey`,
 * computed exactly rather than guessed at from text — see that module's
 * own doc comment). Every other region kind, and every string that isn't
 * a dict key, is left to the shared `looksLikeProse` text heuristic alone.
 *
 * `cfg` is threaded through only because `emitContext`'s own signature
 * requires one (for `concatStyle` resolution, irrelevant to this narrower
 * question) — `wrap.ts` already has the real one in scope when it calls
 * this hook, so there's no placeholder to invent.
 */
function isProseEligible(region: WrappableRegion, _source: string, tree: Tree, cfg: WrapConfig): boolean {
  if (region.kind !== 'stringLiteral') {
    return true;
  }
  return !emitContext(region, tree, cfg).isDictKey;
}

/**
 * Python's `proseText` override: the dissolved logical text (quote
 * delimiters and prefix letters stripped, per `./dissolve-string.ts`)
 * rather than the raw source slice `LanguageAdapter.proseText`'s own doc
 * comment names as the (wrong, for Python) default.
 *
 * Only ever called by `wrap.ts` for `'stringLiteral'` regions that have
 * already passed `isSafeToWrap` (never raw/byte/mixed-prefix/line-
 * continuation/irregular-whitespace), so `dissolveString`'s own
 * preconditions are already satisfied for every region reaching its branch
 * below.
 *
 * A single-part triple-quoted region is the one exception (Phase 12f):
 * `dissolveString`'s own `PREFIX_AND_QUOTE` regex never matches a
 * triple-quote delimiter and would throw, so it's routed to
 * `dissolveDocstring` instead — the same dissolve `./wrap-code-string.ts`
 * itself uses, since `isSafeToWrap` has already confirmed this exact shape
 * (and its own `looksLikeProse` gate) before `wrap.ts` ever calls this.
 */
function proseText(region: WrappableRegion, source: string): string {
  if (region.kind === 'stringLiteral' && isSingleTripleQuotedLiteral(region, source)) {
    return dissolveDocstring(region, source).text;
  }
  return dissolveString(region, source).text;
}

/**
 * Python's `classify` override.
 *
 * Handles both node types the descriptor's queries ever hand it —
 * `discoverRegions` calls this uniformly for comment and string captures
 * alike (see its own doc comment on why), so this can't only know about
 * strings:
 *
 * - `comment` nodes are always `'lineComment'`. Python has no block
 *   comments or a separate doc-comment marker (docstrings *are* Python's
 *   documentation comments, and they're strings, not comments — see
 *   below), so there's no distinction to make here.
 * - `string` nodes are `'docstring'` if `isDocstringPosition` or
 *   `isAttributeDocstringPosition` says so, else the driver's own default
 *   would already be right, but this still names it explicitly rather
 *   than returning `undefined`/falling through — a hook that's defined at
 *   all is expected to handle every node type its queries can produce.
 *
 * Never returns `null`: nothing this adapter's queries capture should be
 * excluded from discovery outright at this phase. (`isSafeToWrap`, added
 * later in this phase, is where "found but shouldn't be wrapped" belongs
 * — that's a distinct question from "found at all".)
 */
function classify(node: SyntaxNode): RegionKind | null {
  if (node.type === 'comment') {
    return 'lineComment';
  }
  if (node.type === 'string') {
    return isDocstringPosition(node) || isAttributeDocstringPosition(node)
      ? 'docstring'
      : 'stringLiteral';
  }
  // Defensive: `pythonDescriptor.queries` only ever captures `comment` and
  // `string` nodes. Reaching here would mean a query was broadened
  // without updating this function to match.
  return null;
}

/**
 * Python's `isSafeToWrap` override.
 *
 * Only string-shaped regions (`'stringLiteral'`, `'docstring'`) are ever
 * flagged unsafe here — a comment region always returns `true`; directive
 * comments that must never be reflowed (`# noqa`, `# type:`, ...) are a
 * `neverReflow`-pattern concern for whatever consumes `pythonDescriptor`
 * once wrapping itself exists (Phase 6), not this hook's job.
 *
 * For a string-shaped region, unsafe means either:
 *
 * - **Raw or byte-prefixed.** A raw string's backslash sequences aren't
 *   real escapes — reflowing one risks producing a value that's no longer
 *   character-for-character what the source said, and a byte string is
 *   rarely prose in the first place (per the plan: "r-strings and
 *   b-strings must be flagged as non-reflowable by default").
 * - **Mixed prefixes across a concatenation run's parts.** `region.parts`
 *   only receives `source` and the region itself, not a live syntax node
 *   (see `discoverRegions`'s doc comment on why `isSafeToWrap`'s signature
 *   looks like it does), so each part's own text is recovered with
 *   `sliceSpanText` before parsing its prefix.
 *
 * A part whose text doesn't parse as a recognizable string literal at all
 * (`extractPrefix` returning `null`) is treated as unsafe rather than
 * thrown on — reachable in principle for a hand-built `WrappableRegion`
 * that doesn't correspond to real discovered output, and "assume unsafe"
 * is the failure mode that can't corrupt a file.
 *
 * Phase 9 adds two more unsafe cases, both scoped to `'stringLiteral'`
 * only (never `'docstring'` — a docstring is *always* legitimately
 * triple-quoted, and that's `wrapDocstring`'s own territory, unaffected
 * by any of this):
 *
 * - **Triple-quoted, multi-part.** A concatenation run with a triple-quoted
 *   part (`"""a""" """b"""`, or a triple-quoted part mixed with ordinary
 *   ones) stays unsafe: `dissolveString`/`emitString`
 *   (`./dissolve-string.ts`, `./emit-string.ts`) — and `wrapCodeString`
 *   (`./wrap-code-string.ts`), Phase 12f's own triple-quoted pipeline —
 *   are each built around one specific shape (every part a single physical
 *   line, or exactly one part however many lines it spans) that a
 *   multi-part triple-quoted run satisfies neither of. Real, separate work
 *   nothing in the plan currently asks for.
 * - **Triple-quoted, single-part: safe, but only if it looks like prose.**
 *   An ordinary (non-docstring) triple-quoted string is real Python (Phase
 *   3: "arbitrary triple-quoted strings are treated as ordinary string
 *   literals"), and Phase 12f ("Triple-quoted non-docstring code strings")
 *   is what stops deferring it — `./wrap-code-string.ts` reuses
 *   `wrapDocstring`'s own dissolve/segment/emit pipeline, since neither
 *   `dissolveDocstring` nor `emitDocstring` actually depends on docstring
 *   *position* (see that module's own doc comment). Gating this on
 *   `looksLikeProse` *here* — unconditionally, regardless of
 *   `cfg.stringPolicy`, and not bypassable by a `# rewrap: force`
 *   directive — rather than leaving it to `wrap.ts`'s own `'prose'`-policy
 *   branch the way every other `'stringLiteral'` is gated, is deliberate:
 *   unlike the concatenation-based pipeline, `wrapCodeString` is *not*
 *   value-preserving (PEP-257 indent-stripping and paragraph-style
 *   whitespace normalization really do change what the string evaluates
 *   to — the same trade-off a docstring already accepts). That makes this
 *   heuristic a genuine safety rule for this one shape, not merely a
 *   stylistic default `stringPolicy: 'all'` or `force` should be able to
 *   opt out of — the same "never bypass a hard structural refusal"
 *   posture raw/byte strings already establish just above. A code-shaped
 *   triple-quoted string (an embedded SQL query, a template, ASCII art) is
 *   expected to fail this heuristic and stay untouched, exactly as the
 *   Phase 3 note predicted for triple-quoted strings in general ("likely
 *   to fail the prose heuristic anyway").
 * - **Contains a line-continuation escape** (`\` immediately followed by a
 *   real newline) in any part. The plan calls this out by name as a
 *   refusal case ("Refuse (mark unsafe): ... strings with line
 *   continuations"): a line-continuation escape consumes the newline
 *   itself (it contributes nothing to the string's value), which
 *   `dissolveString`'s "never decode, just concatenate bodies verbatim"
 *   design has no way to represent — concatenating a body that still
 *   contains `\` + a real newline character straight through would hand
 *   `atomizeWords` a body containing an actual line break, which its
 *   single-line contract doesn't expect.
 * - **Contains a tab, or a run of two or more consecutive spaces.**
 *   Neither the plan nor any earlier phase names this one explicitly —
 *   found while generating this phase's own gold fixtures, when a run of
 *   the actual pipeline against real prose text revealed it, rather than
 *   being anticipated up front. `atomizeWords`
 *   (`../../segmentation/atomize-words.ts`) is prose-reflow machinery: it
 *   treats *any* run of whitespace as a plain word boundary and always
 *   re-renders exactly one space between words, discarding the original
 *   run's actual width. That's the right behavior for a comment or
 *   docstring paragraph (cosmetic prose formatting is the entire point),
 *   but it would silently change a string literal's real *value* —
 *   `"foo  bar"` (two spaces) or `"foo\tbar"` re-rendering as `"foo bar"`
 *   — even on a single line that was never split at all. Refusing any
 *   string whose word-separating whitespace isn't already a plain single
 *   space sidesteps the problem entirely rather than teaching the
 *   segmentation layer to preserve exact whitespace width, which no other
 *   caller of `atomizeWords` needs and would be real, separate work.
 */
function isSafeToWrap(region: WrappableRegion, source: string): boolean {
  if (region.kind !== 'stringLiteral' && region.kind !== 'docstring') {
    return true;
  }

  const prefixes = region.parts.map((part) => extractPrefix(sliceSpanText(source, part)));
  if (prefixes.some((prefix) => prefix === null)) {
    return false;
  }

  const classified = prefixes.map((prefix) => classifyPrefix(prefix!));
  if (classified.some((p) => p.raw || p.bytes)) {
    return false;
  }

  if (classified.length > 1) {
    const distinctNormalized = new Set(classified.map((p) => p.normalized));
    if (distinctNormalized.size > 1) {
      return false; // mixed prefixes within one concatenation run
    }
  }

  if (region.kind === 'stringLiteral') {
    const partTexts = region.parts.map((part) => sliceSpanText(source, part));
    if (partTexts.some((text) => TRIPLE_QUOTE_BODY.test(text))) {
      if (region.parts.length > 1) {
        return false; // concatenation run involving a triple-quoted part: still deferred
      }
      return looksLikeProse(dissolveDocstring(region, source).text);
    }
    if (partTexts.some((text) => LINE_CONTINUATION.test(text))) {
      return false;
    }
    if (partTexts.some((text) => IRREGULAR_WHITESPACE.test(text))) {
      return false;
    }
  }

  return true;
}

const TRIPLE_QUOTE_BODY = /^[A-Za-z]{0,3}('''|""")/;
const LINE_CONTINUATION = /\\\r?\n/;
const IRREGULAR_WHITESPACE = /\t| {2}/;

/**
 * Python's `groupRegions` override.
 *
 * Merges consecutive `'lineComment'` regions at the same indent column
 * into a single multi-part region — Phase 6's "consecutive `#` comments
 * at the same indent = one logical block." Unlike concatenation-run
 * grouping (handled inside `discoverRegions` itself, since it needs
 * direct tree access to walk `concat.implicit`/`concat.operator`
 * captures — see that module's doc comment), merging adjacent comment
 * *lines* only needs each region's own span and `indentColumn`, both
 * already on `WrappableRegion` — exactly what this hook's signature
 * provides, so it belongs here rather than in the driver.
 *
 * `discoverRegions` sorts its final return value, but does *not*
 * guarantee the order regions arrive in when handed to this hook (the
 * driver builds concatenation regions, then comments, then leftover
 * strings, each batch in tree-sitter capture order, which is source
 * order but not merged/sorted across kinds) — so `'lineComment'` entries
 * are pulled out and sorted by position before the adjacency scan runs,
 * rather than trusting incoming order. Every other kind passes through
 * untouched and in whatever relative order it arrived in, since the
 * final `sortByPosition` in `discoverRegions` fixes that up regardless.
 *
 * Two regions merge only if they're on strictly consecutive source rows
 * (`b.span.startRow === a.span.endRow + 1`) *and* share the same
 * `indentColumn` — a comment one line below but at a different
 * indentation (e.g. entering or leaving a nested block) starts a new
 * logical block instead of extending this one. This also means a
 * trailing comment (`x = 1  # note`) essentially never merges with an
 * unrelated standalone comment on the next line, since the two are
 * exceedingly unlikely to land on the same visual column by accident.
 */
function groupRegions(regions: readonly WrappableRegion[]): WrappableRegion[] {
  const others = regions.filter((region) => region.kind !== 'lineComment');
  const comments = regions
    .filter((region) => region.kind === 'lineComment')
    .slice()
    .sort((a, b) => a.span.startRow - b.span.startRow || a.span.startColumn - b.span.startColumn);

  const merged: WrappableRegion[] = [];
  let run: WrappableRegion[] = [];

  const flushRun = (): void => {
    if (run.length === 0) {
      return;
    }
    merged.push(run.length === 1 ? run[0]! : mergeLineCommentRun(run));
    run = [];
  };

  for (const region of comments) {
    const prev = run[run.length - 1];
    const continuesRun =
      prev !== undefined &&
      region.span.startRow === prev.span.endRow + 1 &&
      region.indentColumn === prev.indentColumn;
    if (!continuesRun) {
      flushRun();
    }
    run.push(region);
  }
  flushRun();

  return [...others, ...merged];
}

/**
 * Combine a run of single-part `'lineComment'` regions (adjacent source
 * lines, same indent — guaranteed by `groupRegions`'s caller) into one
 * multi-part region spanning all of them.
 *
 * `rawText` approximates the true source slice by joining each part's
 * own text with `'\n' + ' '.repeat(indentColumn)` — reconstructing the
 * newline and re-indentation that sit *between* parts in real source,
 * which individual `WrappableRegion.rawText` values (each just their own
 * node's text, no surrounding whitespace — see `discoverRegions`'s
 * `buildRegion`) don't carry. This is exact for the overwhelmingly
 * common case of space-only indentation; a merged region indented with
 * tabs would see its `rawText` (display/debugging use only — see that
 * field's own doc comment) diverge slightly from the true byte sequence,
 * since `indentColumn` is tab-*expanded*. Nothing downstream treats
 * `rawText` as authoritative for a multi-part region: `wrapRegions`
 * (Phase 6's wrap entry point) compares prospective edits against a
 * fresh `sliceSpanText(source, region.span)` instead, precisely to avoid
 * depending on this approximation for correctness.
 */
function mergeLineCommentRun(run: readonly WrappableRegion[]): WrappableRegion {
  const first = run[0]!;
  const last = run[run.length - 1]!;
  const indentPrefix = '\n' + ' '.repeat(first.indentColumn);

  return {
    kind: 'lineComment',
    span: {
      startByte: first.span.startByte,
      endByte: last.span.endByte,
      startRow: first.span.startRow,
      startColumn: first.span.startColumn,
      endRow: last.span.endRow,
      endColumn: last.span.endColumn,
    },
    parts: run.flatMap((region) => region.parts),
    rawText: run.map((region) => region.rawText).join(indentPrefix),
    indentColumn: first.indentColumn,
    languageId: first.languageId,
  };
}

/**
 * Python's `LanguageAdapter`.
 *
 * `classify` tells a docstring apart from an ordinary string literal by
 * its syntactic position. `isSafeToWrap` flags raw strings, byte strings,
 * and mixed-prefix concatenation runs as unsafe to wrap. `groupRegions`
 * merges consecutive same-indent line comments into one logical block
 * (Phase 6). Concatenation-run *grouping* is not implemented as part of
 * this hook — it needs direct syntax-tree access that hook's signature
 * doesn't provide, so it lives in the discovery driver instead, keyed
 * off `descriptor.queries.concatenations` (see that commit's message for
 * the full reasoning). `wrapDocstring` (Phase 8) is Python's whole
 * dissolve→segment→reflow→emit pipeline for `'docstring'` regions — see
 * `./wrap-docstring.ts` and that hook's own doc comment on
 * `../../types/adapter.ts` for why it's one hook rather than several.
 * `emitContext` (Phase 9, `./emit-context.ts`) answers whether a
 * `'stringLiteral'` split needs its own inserted parentheses and which
 * concatenation syntax to preserve; `wrapString` (`./wrap-string.ts`) is
 * that region kind's own whole-pipeline hook, the same shape as
 * `wrapDocstring` for the same reason. `isProseEligible` adds the one
 * context signal `emitContext` already has the tree access to answer
 * exactly (a dict literal's key) on top of the shared text-only
 * `looksLikeProse` heuristic.
 */
export const pythonAdapter: LanguageAdapter = {
  descriptor: pythonDescriptor,
  classify,
  groupRegions,
  isSafeToWrap,
  isProseEligible,
  proseText,
  emitContext,
  wrapDocstring,
  wrapString,
};
