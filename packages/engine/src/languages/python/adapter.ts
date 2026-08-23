import type { LanguageAdapter } from '../../types/adapter.js';
import { pythonDescriptor } from './descriptor.js';

/**
 * Python's `LanguageAdapter`.
 *
 * Still a skeleton as of this commit: `descriptor` alone is enough for
 * `discoverRegions` (`../../discovery/discover-regions.ts`) to find every
 * comment and string literal in a Python file, using the driver's default
 * classification (`'lineComment'` / `'stringLiteral'`) for all of them.
 * What's missing — and lands over the rest of this phase — is everything
 * that makes those defaults too coarse for Python specifically:
 *
 * - `classify`: telling a docstring apart from an ordinary string literal
 *   by its syntactic position (next commit).
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
};
