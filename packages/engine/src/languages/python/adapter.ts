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
 * Python's `LanguageAdapter`.
 *
 * `classify` tells a docstring apart from an ordinary string literal by
 * its syntactic position. `isSafeToWrap` flags raw strings, byte strings,
 * and mixed-prefix concatenation runs as unsafe to wrap. Concatenation-run
 * *grouping* is not implemented as a `groupRegions` override — it needs
 * direct syntax-tree access that hook's signature doesn't provide, so it
 * lives in the discovery driver instead, keyed off
 * `descriptor.queries.concatenations` (see that commit's message for the
 * full reasoning). `emitContext` isn't implemented yet; that's Phase 9's
 * job, once paren-insertion for bare multi-part literals is a real
 * question to answer.
 */
export const pythonAdapter: LanguageAdapter = {
  descriptor: pythonDescriptor,
  classify,
  isSafeToWrap,
};
