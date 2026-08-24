import type { LanguageAdapter } from '../../types/adapter.js';
import type { RegionKind, WrappableRegion } from '../../types/region.js';
import type { SyntaxNode } from '../../types/tree-sitter-types.js';
import { sliceSpanText } from '../../discovery/slice-span.js';
import { pythonDescriptor } from './descriptor.js';
import { isAttributeDocstringPosition, isDocstringPosition } from './docstring-position.js';
import { classifyPrefix, extractPrefix } from './prefix.js';

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

  return true;
}

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
 * the full reasoning). `emitContext` isn't implemented yet; that's Phase
 * 9's job, once paren-insertion for bare multi-part literals is a real
 * question to answer.
 */
export const pythonAdapter: LanguageAdapter = {
  descriptor: pythonDescriptor,
  classify,
  groupRegions,
  isSafeToWrap,
};
