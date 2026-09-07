import type { LanguageDescriptor } from '../../types/adapter.js';

/**
 * LaTeX's `LanguageDescriptor` -- commit 14's scope only: `%` comment
 * paragraphs, flowing through the *existing* `'lineComment'` machinery
 * (`dissolveLineComments`/`emitLineComments`) exactly like Python's `#`
 * comments do, no new engine code needed. `queries.prose` (the masked
 * line-scan `discoverProse` needs, since this grammar has no paragraph
 * node at all, `docs/parsing.md` Finding 8) is deliberately absent
 * until commit 15; a LaTeX file with no comments produces zero
 * regions from this descriptor alone, same as any other prose-less commit.
 *
 * Node names and shapes below were verified against the vendored grammar
 * (`@pfoerster/tree-sitter-latex@0.6.0`, `packages/engine/grammars/`) with
 * throwaway probe scripts, not trusted from memory -- see
 * `docs/spikes/tree-sitter-latex-probe.mjs`/`-probe2.mjs`/`-probe3.mjs` and
 * `docs/parsing.md` Finding 8. Two probe-confirmed facts this descriptor
 * depends on directly:
 *
 * - A `line_comment` node's span never includes a trailing `\r` on a
 *   CRLF-terminated line (`-probe3.mjs`'s "line_comment on CRLF-terminated
 *   line" section) -- unlike Python's `comment` node, which does (see
 *   `docs/adapters.md`'s "CRLF handling"). `trimTrailingCR` is a
 *   confirmed no-op here, not an assumed one.
 * - `\%` (escaped percent) never produces a `line_comment` node and never
 *   an `ERROR` node either (`-probe3.mjs`'s "escaped percent" section) --
 *   the grammar itself already distinguishes an unescaped `%` from `\%`,
 *   so no adapter-level re-lexing is ever needed for that distinction.
 */
export const latexDescriptor: LanguageDescriptor = {
  id: 'latex',

  grammarWasm: 'grammars/tree-sitter-latex.wasm',

  queries: {
    comments: '(line_comment) @comment',
  },

  comments: {
    line: { marker: '%', spaceAfter: true },

    /**
     * Directive comments that must never be reflowed regardless of
     * policy, mirroring Python's own `neverReflow` rationale
     * (`../python/descriptor.ts`'s doc comment) for the LaTeX-specific
     * equivalents:
     *
     * - `%!TEX ...` -- TeXShop/TeXworks/LaTeXTools "magic comment" pragmas
     *   (`root`, `encoding`, `TS-program`, ...); moving one to a
     *   different line or reflowing its content breaks the tool reading
     *   it. One pattern covers both the spaced (`%! TeX`) and unspaced
     *   (`%!TEX`) forms `-probe2.mjs` confirmed real editors emit -- the
     *   plan's draft listed these as two separate patterns differing only
     *   in an optional space and case, which `\s*` and the `/i` flag
     *   already both cover in one regex; simplified here after
     *   confirming the redundancy directly against probe output rather
     *   than carrying two patterns on faith.
     * - `^%%` -- banner/rule comments (`%%%%%%%%%%`, a common section-divider
     *   convention); `-probe2.mjs`'s "%% banner comment" section confirmed
     *   each such line is its own separate `line_comment` node with no
     *   grammar-level distinction from ordinary prose comments, so this
     *   regex is the only thing telling them apart.
     */
    neverReflow: [/^%\s*!\s*TeX\b/i, /^%%/],

    /**
     * Commented-out LaTeX source (`% \section{Old title}`) is caught by
     * this plus the shared punctuation-density signal
     * (`../../comments/looks-like-code.ts`'s `CODE_PUNCTUATION`, which
     * already weights `{}[]\`-heavy lines as code) -- the identical
     * two-signal design Python's own `codeLikeKeywords` doc comment
     * describes, applied to LaTeX's preamble/definition commands instead
     * of Python's statement keywords. Anchored to the start of the
     * (already `%`-stripped, trimmed) line: a backslash immediately
     * followed by one of these command names is LaTeX source syntax no
     * prose sentence would ever begin with verbatim.
     */
    codeLikeKeywords: /^\\(documentclass|usepackage|newcommand|renewcommand|def|let|input|include)\b/,
  },
};
