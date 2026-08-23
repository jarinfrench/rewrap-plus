import type { LanguageAdapter } from '../../types/adapter.js';
import type { RegionKind } from '../../types/region.js';
import type { SyntaxNode } from '../../types/tree-sitter-types.js';
import { pythonDescriptor } from './descriptor.js';
import { isAttributeDocstringPosition, isDocstringPosition } from './docstring-position.js';

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
 * Python's `LanguageAdapter`.
 *
 * `classify` (above) tells a docstring apart from an ordinary string
 * literal by its syntactic position. Still missing, landing later in this
 * phase:
 *
 * - concatenation-run grouping: merging adjacent string literals into one
 *   multi-part region (`descriptor.queries.concatenations`, plus the
 *   generic grouping this adds to the discovery driver).
 * - `isSafeToWrap`: flagging raw strings, byte strings, and mixed-prefix
 *   concatenation runs as unsafe to wrap.
 *
 * `groupRegions` and `emitContext` are not overridden here, and Python
 * doesn't need `groupRegions` at all — concatenation grouping turns out
 * to need direct syntax-tree access (to walk `concatenated_string`'s
 * children, and to recurse through a `+` chain checking every operand is
 * itself a string literal) that `groupRegions(regions)`'s signature
 * doesn't provide. See the grouping commit's message for why that logic
 * lives in the discovery driver instead, keyed off
 * `descriptor.queries.concatenations`.
 */
export const pythonAdapter: LanguageAdapter = {
  descriptor: pythonDescriptor,
  classify,
};
