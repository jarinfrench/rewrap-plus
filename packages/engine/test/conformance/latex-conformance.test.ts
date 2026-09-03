import { latexAdapter } from '../../src/languages/latex/adapter.js';
import { runAdapterConformance } from '../../src/conformance/run-adapter-conformance.js';

/**
 * Real sources, exercising the adapter's full pipeline —
 * `docs/planning/markdown-latex-plan.md` Phase D commit 18, once every
 * other real piece of the adapter (comments, discovery, wrapping,
 * trailing-comment safety, `\verb` unbreakability) already exists and has
 * its own gold fixtures. Three source shapes, each with a CRLF and LF
 * variant: a `%` comment paragraph (the `'lineComment'` path, unchanged
 * since commit 14), an ordinary prose paragraph following a section
 * header (the `'prose'` path, §6.2/§6.3), and an itemized list (`\item`
 * indentation, §6.3) — between them exercising both region kinds this
 * adapter ever discovers.
 *
 * Deliberately no trailing-`%`-comment or `\\`/`\newline` hard break in
 * any source here, mirroring `./markdown-conformance.test.ts`'s own
 * choice and for the identical reason: this kit's trailing-whitespace
 * invariant is kept strict with no carve-out, and a hard break's own
 * glued marker is tested for real by
 * `../wrap/latex-comment-safety-fixtures.test.ts`'s region-aware gold
 * fixtures instead, which can tell "expected" glued content apart from a
 * regression in a way this kit's flat before/after comparison can't.
 */
const COLUMN_LIMIT = 40;

const COMMENT_CRLF_SOURCE =
  '% This is a long line comment that will\r\n' +
  '% need wrapping under a narrow column limit for sure.\r\n';
const COMMENT_LF_SOURCE = COMMENT_CRLF_SOURCE.replace(/\r\n/g, '\n');

const PARAGRAPH_CRLF_SOURCE =
  '\\section{Introduction}\r\n' +
  '\r\n' +
  'This is an ordinary LaTeX paragraph, long enough that it will need\r\n' +
  'wrapping under a narrow column limit for sure.\r\n';
const PARAGRAPH_LF_SOURCE = PARAGRAPH_CRLF_SOURCE.replace(/\r\n/g, '\n');

const LIST_CRLF_SOURCE =
  '\\begin{itemize}\r\n' +
  '  \\item This first item has enough text in it to need wrapping onto a continuation line for sure.\r\n' +
  '  \\item Short second item.\r\n' +
  '\\end{itemize}\r\n';
const LIST_LF_SOURCE = LIST_CRLF_SOURCE.replace(/\r\n/g, '\n');

runAdapterConformance(latexAdapter, {
  wasmDir: '.',
  columnLimit: COLUMN_LIMIT,
  sources: [
    COMMENT_CRLF_SOURCE,
    COMMENT_LF_SOURCE,
    PARAGRAPH_CRLF_SOURCE,
    PARAGRAPH_LF_SOURCE,
    LIST_CRLF_SOURCE,
    LIST_LF_SOURCE,
  ],
});
