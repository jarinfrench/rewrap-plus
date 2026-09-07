import type { LanguageDescriptor } from '../../types/adapter.js';

/**
 * PowerShell's `LanguageDescriptor` — comment-only, no string-literal
 * support (see `./adapter.ts`'s own doc comment for why `strings` is
 * omitted).
 *
 * Node names and shapes verified against the vendored grammar
 * (`tree-sitter-powershell@0.26.4`, `../../../grammars/`) with a
 * throwaway probe script — see
 * `docs/spikes/tree-sitter-comment-langs-batch-probe.mjs` and
 * `docs/language-candidates.md`'s PowerShell row. The short version:
 *
 * - **One `comment` node type covers all three comment forms** — a `#`
 *   line comment, a plain `<# ... #>` block comment, *and* a
 *   `<# ... #>` comment-based-help block (`.SYNOPSIS`/`.DESCRIPTION`/
 *   `.PARAMETER` tags) alike. Probed directly: a top-level
 *   `<# .SYNOPSIS ... #>` block produces the exact same `comment` node
 *   type as an ordinary `<# plain #>` one — there is no distinct,
 *   query-able node shape for comment-based help the way Java's
 *   `line_comment`/`block_comment` split gives Javadoc for free. This
 *   confirms `docs/language-candidates.md`'s own open question ("confirm
 *   this against the actual grammar node shapes before adding [a new
 *   `DocDialectId`]") the way it asked to be confirmed: **not** a
 *   distinct node type, but that's the same situation JSDoc/Doxygen/
 *   Javadoc are already in — none of those get a distinct node type
 *   either (a `comment`/`block_comment` node's own text is the only
 *   signal in every case already shipped), so text-content
 *   classification is the established mechanism here too, not a new one.
 *   See `./adapter.ts`'s `classify` for exactly how a comment-based-help
 *   block is told apart from a plain one — by tag vocabulary, not by
 *   marker prefix the way `/**`/`\tag`/`@tag` are, since `<#` alone is
 *   shared by both forms.
 * - **No `///`-repeated-marker doc-comment form** — PowerShell has no
 *   counterpart to Doxygen's `///`; every doc-shaped comment uses the
 *   `<# ... #>` open/close pair.
 * - **String support is deliberately out of scope for this pass** — see
 *   `./adapter.ts`'s doc comment for the interpolation/here-string gaps
 *   that motivate leaving it out.
 */
export const powershellDescriptor: LanguageDescriptor = {
  id: 'powershell',
  grammarWasm: 'grammars/tree-sitter-powershell.wasm',

  queries: {
    comments: '(comment) @comment',
  },

  comments: {
    line: { marker: '#', spaceAfter: true },

    // `<# ... #>` is the *only* block delimiter PowerShell has — shared,
    // unlike C/JS/Java, by both a plain block comment and a
    // comment-based-help one (see this module's own doc comment above),
    // so no separate `plainBlock` is needed the way JSDoc's `/**` vs `/*`
    // split requires one: `../../comments/emit-block-comments.ts` already
    // falls back to `comments.block` when `plainBlock` is unset, which is
    // exactly the shared-delimiter shape here.
    block: { open: '<#', close: '#>' },

    // `markers` records the one real delimiter `classify` inspects
    // (`<#`) — required non-empty by `validateDescriptor`, but the actual
    // plain-vs-help distinction is text-content-based (tag vocabulary),
    // not a literal-prefix `startsWith` check the way every earlier
    // `doc.markers` entry is; see `./adapter.ts`'s `classify`.
    doc: { markers: ['<#'], dialects: ['commentBasedHelp', 'plain'] },

    neverReflow: [
      /^#!/, // shebang — PowerShell Core scripts on Unix may start with one
      /^#\s*[Rr]equires\b/, // `#Requires -Version ...` — a real, position/text-sensitive directive
      /^#\s*region\b/i, // VSCode/ISE folding marker
      /^#\s*endregion\b/i,
    ],

    // Statement/keyword leads strong enough on their own to call a
    // dissolved `#` comment line code-like (the commented-out-code
    // detection) without needing the punctuation-density signal too —
    // PowerShell's counterpart to Python's `def `/`class `/`import `/...
    // list. Anchored to the start of the (already-trimmed) line.
    codeLikeKeywords:
      /^(function\s|param\s*\(|if\s*\(|elseif\s*\(|else\b|foreach\s*\(|for\s*\(|while\s*\(|switch\s*\(|try\s*\{|catch\b|finally\s*\{|return\b|\$\w+\s*=|Write-\w+|Import-Module\b|\[CmdletBinding)/i,
  },
};
