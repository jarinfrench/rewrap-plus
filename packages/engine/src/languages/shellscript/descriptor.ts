import type { LanguageDescriptor } from '../../types/adapter.js';

/**
 * Shell script (Bash)'s `LanguageDescriptor` -- VSCode's `shellscript`
 * languageId. Comment-only, no string-literal support (see `./adapter.ts`'s
 * own doc comment for why `strings` is omitted entirely).
 *
 * Node names and shapes verified against the vendored grammar
 * (`tree-sitter-bash@0.25.1`, `../../../grammars/`) with a throwaway probe
 * script -- see `docs/spikes/tree-sitter-comment-langs-batch-probe.mjs`
 * and `docs/language-candidates.md`'s "Shell script (Bash)" row for the
 * investigation this descriptor is built from. The short version:
 *
 * - **One `comment` node type**, covering the shebang line
 *   (`#!/bin/bash`), a standalone `# ...` comment, and a comment trailing
 *   a command on the same line alike -- identical shape to Python's own
 *   `comment` node, no block form at all. No `classify` override needed:
 *   `discoverRegions`'s default fallback (`'lineComment'` for every
 *   `@comment` capture) is already correct, since Bash has no other
 *   comment-shaped `RegionKind` to distinguish.
 * - **No doc-comment convention** in this grammar -- `comments.doc` is
 *   left unset.
 * - **String support is deliberately out of scope for this pass** -- see
 *   `./adapter.ts`'s doc comment for the heredoc/interpolation gaps that
 *   motivate leaving it out rather than a partial, unsafe attempt.
 */
export const shellscriptDescriptor: LanguageDescriptor = {
  id: 'shellscript',
  grammarWasm: 'grammars/tree-sitter-bash.wasm',

  queries: {
    comments: '(comment) @comment',
  },

  comments: {
    line: { marker: '#', spaceAfter: true },

    neverReflow: [
      /^#!/, // shebang -- moving or rewording it changes how the script is invoked
      /^#\s*shellcheck\b/i, // shellcheck directive, e.g. `# shellcheck disable=SC2086`
    ],

    // Statement/keyword leads strong enough on their own to call a
    // dissolved `#` comment line code-like (the commented-out-code
    // detection) without needing the punctuation-density signal too --
    // Bash's counterpart to Python's `def `/`class `/`import `/... list.
    // Anchored to the start of the (already-trimmed) line.
    codeLikeKeywords:
      /^(#!|if\s|then\b|elif\s|else\b|fi\b|for\s|while\s|until\s|do\b|done\b|case\s|esac\b|function\s|local\s|export\s|readonly\s|return\b|exit\b|source\s|\.\s|echo\s|set\s+-)/,
  },
};
