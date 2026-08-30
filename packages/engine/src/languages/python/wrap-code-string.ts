import type { WrapConfig } from '../../types/config.js';
import type { WrappableRegion } from '../../types/region.js';
import type { ReflowOptions } from '../../reflow/reflow-block.js';
import type { SplitBlocksOptions } from '../../segmentation/split-blocks.js';
import { plainDialect } from '../../docs/plain.js';
import { dissolveDocstring } from './dissolve-docstring.js';
import { emitDocstring } from './emit-docstring.js';

/**
 * Wrap a *non-docstring* triple-quoted `'stringLiteral'` region — a case
 * explicitly deferred when docstring detection was first scoped to
 * syntactic position only ("arbitrary triple-quoted strings are treated
 * as ordinary string literals") and then hard-refused outright
 * (`./adapter.ts`'s `isSafeToWrap`), until this module.
 *
 * ## Reuses the docstring pipeline verbatim, not a fork of it
 *
 * `dissolveDocstring`/`emitDocstring` (`./dissolve-docstring.ts`,
 * `./emit-docstring.ts`) have never actually depended on docstring
 * *position* — both operate purely on a triple-quoted literal's own text
 * shape (prefix, quote delimiter, PEP-257 physical-line/indentation
 * structure), which is identical whether or not the string happens to sit
 * where CPython would recognize it as `__doc__`. Calling them here directly,
 * rather than duplicating their logic, is the same "promote once a second
 * real consumer needs it" call this project has made repeatedly (see
 * `docs/adapters.md`'s JavaScript canary and JavaScript/TypeScript/TSX —
 * full adapters sections) — except here the second consumer needed
 * literally the same functions, not a copy.
 *
 * Always segments with `plainDialect` directly — paragraph/list/verbatim
 * structure only — rather than `./wrap-docstring.ts`'s `resolveDialectId`
 * (which honors `cfg.docDialect`'s Google/NumPy/Sphinx choice). Those three
 * dialects exist to parse a *documentation* convention (`Args:`,
 * `Parameters\n----------`, `:param x:`); a plain program value has no
 * business being scanned for one — a JSON blob or a multi-line error
 * message that happens to contain a colon-terminated line would otherwise
 * risk being misread as a field list purely because the user's *docstrings*
 * elsewhere in the file happen to use that dialect.
 *
 * ## This is a value-changing operation — unlike every other `'stringLiteral'`
 *
 * Every other string-literal wrap in this package (`./wrap-string.ts`) is
 * value-preserving by construction: splitting across a concatenation
 * boundary inserts zero characters into the string's own runtime value
 * (see `../../strings/dissolve-string.ts`'s own doc comment). This pipeline
 * is not — PEP-257 common-indent stripping and paragraph-style whitespace
 * normalization (the same trade-off `wrapDocstring` already makes, and
 * this project has accepted since docstring wrapping was first built)
 * really do change what the string evaluates to, not merely how it's
 * laid out. That is exactly why
 * `isSafeToWrap` (`./adapter.ts`) gates this pipeline behind
 * `looksLikeProse` *unconditionally* — regardless of `cfg.stringPolicy`,
 * and not bypassable by a `# rewrap: force` directive either — rather than
 * only under the conservative `'prose'` policy the way every other
 * `'stringLiteral'` is gated in `../../wrap.ts`. A code-shaped triple-quoted
 * string (an embedded SQL query, a template, ASCII art) is expected to fail
 * that heuristic and never reach this function at all.
 */
export function wrapCodeString(region: WrappableRegion, source: string, cfg: WrapConfig): string {
  const dissolved = dissolveDocstring(region, source);

  const splitOptions: SplitBlocksOptions = { preserveIndentedBlocks: cfg.preserveIndentedBlocks };
  const blocks = plainDialect.segment(dissolved.text, splitOptions);

  const reflowOptions: ReflowOptions = { mode: cfg.balancedWrapping ? 'balanced' : 'greedy' };
  return emitDocstring(blocks, dissolved, cfg.columnLimit, reflowOptions);
}
