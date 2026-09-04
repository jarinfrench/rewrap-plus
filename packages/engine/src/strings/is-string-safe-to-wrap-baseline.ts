import type { WrappableRegion } from '../types/region.js';
import type { SourceSpan } from '../types/span.js';
import { sliceSpanText } from '../discovery/slice-span.js';

const LINE_CONTINUATION = /\\\r?\n/;
const IRREGULAR_WHITESPACE = /\t| {2}/;

/**
 * Engine-level, language-independent baseline for `'stringLiteral'`
 * safety-to-wrap: refuses a region containing a line-continuation escape
 * (`\` immediately followed by a real newline) in any part, or irregular
 * whitespace (a tab, or a run of two or more consecutive spaces) in any
 * *single-physical-line* part.
 *
 * Applied unconditionally by `../wrap.ts`, before it ever consults an
 * adapter's own `LanguageAdapter.isSafeToWrap` hook (see that module's own
 * doc comment on the dispatch site, and `LanguageAdapter.isSafeToWrap`'s own
 * doc comment on `../types/adapter.ts` for the resulting contract) — both
 * gates must pass (AND), with no way for an adapter to waive this one. That
 * follows from *why* each refusal exists: `atomizeWords`/`reflowBlock`
 * (`../segmentation/atomize-words.ts`, `../reflow/reflow-block.ts`) are
 * shared prose-reflow machinery that collapses any whitespace run to one
 * rendered space and has no way to represent an embedded raw newline —
 * true of the shared segmentation pipeline itself, not of any one
 * language's syntax, so no adapter has a legitimate reason to override it.
 *
 * **The irregular-whitespace check is scoped to a single physical source
 * line per part (`part.startRow === part.endRow`), not the whole part
 * regardless of span.** This isn't a Python-specific carve-out smuggled
 * into an otherwise language-agnostic function — it falls out of what the
 * check actually protects: the value-preserving concatenation pipeline
 * (`../strings/dissolve-string.ts` → `atomizeWords` → `../strings/emit-string.ts`,
 * reached via `../strings/wrap-string-default.ts` for every ECMAScript-
 * family adapter and Java, or Python's own `./languages/python/wrap-string.ts`)
 * never itself produces a part spanning more than one physical source
 * line — an ordinary quoted string containing a raw embedded newline is
 * either a parse error (Java, C++, ECMAScript-family) or a genuine
 * line-continuation escape (still caught by the `LINE_CONTINUATION` check
 * above regardless of row span). A part that *does* span multiple physical
 * lines is necessarily some other shape a specific adapter's own
 * `isSafeToWrap`/`wrapString` already has bespoke handling for — Python's
 * single-part triple-quoted string is the one current example
 * (`./languages/python/adapter.ts`'s `isSafeToWrap`, which routes it to
 * `wrapCodeString`/`wrapDocstring` instead of the concatenation pipeline,
 * gated on its own `looksLikeProse` check rather than this one — a
 * multi-line docstring-shaped string's own paragraph indentation is
 * *expected* to contain runs of spaces, and that pipeline already accepts
 * responsibility for normalizing whitespace on purpose, unlike the
 * concatenation pipeline this baseline actually guards). Discovered by
 * running `test/wrap/python-string-wrap-fixtures.test.ts` against an
 * unscoped version of this check: fixture `009-triple-quoted-multiline-
 * prose` (real, expected 4-space paragraph indentation) was incorrectly
 * refused outright.
 *
 * Originally four byte-identical copies of this exact pair of checks lived
 * one per adapter (Python, C++, Java, every ECMAScript-family language),
 * every one of them applying `IRREGULAR_WHITESPACE` only to a
 * `'stringLiteral'` region's own non-triple-quoted branch (Python) or a
 * region shape that can never span multiple rows in the first place (C++,
 * Java, ECMAScript-family) — so this scoping is a faithful, adapter-
 * agnostic restatement of what was already true everywhere, not a new
 * behavior. For Java and ECMAScript-family, this baseline was that
 * adapter's *entire* `isSafeToWrap`, which is why those two now have no
 * hook left to declare at all. Python and C++ each keep their own hook for
 * what's genuinely language-specific beyond this baseline (raw/byte/mixed-
 * prefix and triple-quote handling for Python, prefix-mismatch handling
 * for C++).
 *
 * Deliberately takes no `region.kind` guard: unlike an adapter's own
 * `isSafeToWrap`, which must handle every kind an adapter's `classify` can
 * produce, this function has exactly one caller (`../wrap.ts`'s dispatch),
 * which only ever invokes it from inside a `region.kind === 'stringLiteral'`
 * branch — the same reason `region.parts` is read directly here with no
 * kind check first.
 */
export function isStringSafeToWrapBaseline(region: WrappableRegion, source: string): boolean {
  const partTexts = region.parts.map((part) => sliceSpanText(source, part));
  if (partTexts.some((text) => LINE_CONTINUATION.test(text))) {
    return false;
  }
  if (region.parts.some((part, i) => isSingleLine(part) && IRREGULAR_WHITESPACE.test(partTexts[i]!))) {
    return false;
  }
  return true;
}

function isSingleLine(part: SourceSpan): boolean {
  return part.startRow === part.endRow;
}
