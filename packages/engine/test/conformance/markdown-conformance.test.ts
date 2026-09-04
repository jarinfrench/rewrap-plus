import { markdownAdapter } from '../../src/languages/markdown/adapter.js';
import { runAdapterConformance } from '../../src/conformance/run-adapter-conformance.js';

/**
 * Real sources, exercising the adapter's full pipeline — Phase C
 * commit 12, once
 * `discoverProse`/`wrapProse` (commits 9/10) and hard-break/directive
 * support (commit 11) all exist. Two source shapes, each with a CRLF and
 * LF variant: an ordinary paragraph, and a block-quoted one — between
 * them exercising `'prose'`-region discovery, canonical continuation-
 * prefix derivation, and this kit's own new prose-aware checks
 * (`../../src/conformance/run-adapter-conformance.ts`'s loosened
 * line-length decoration stripping, commit 6).
 *
 * Deliberately no two-space/backslash/`<br>` hard break in either source:
 * this kit's own trailing-whitespace invariant is kept strict with no
 * carve-out (that decision's own doc comment, `run-adapter-conformance.ts`)
 * — a hard break is tested for real by `../wrap/markdown-hard-break-fixtures.test.ts`'s
 * region-aware gold fixtures instead, which can tell "expected" trailing
 * whitespace apart from a regression in a way this kit's flat
 * before/after comparison can't.
 */
const COLUMN_LIMIT = 40;

const PARAGRAPH_CRLF_SOURCE =
  'This is an ordinary Markdown paragraph, long enough that it will need\r\n' +
  'wrapping under a narrow column limit for sure.\r\n';
const PARAGRAPH_LF_SOURCE = PARAGRAPH_CRLF_SOURCE.replace(/\r\n/g, '\n');

const BLOCKQUOTE_CRLF_SOURCE =
  '> This is a block-quoted paragraph, long enough on its own that it will\r\n' +
  '> need wrapping under a narrow column limit too.\r\n';
const BLOCKQUOTE_LF_SOURCE = BLOCKQUOTE_CRLF_SOURCE.replace(/\r\n/g, '\n');

runAdapterConformance(markdownAdapter, {
  wasmDir: '.',
  columnLimit: COLUMN_LIMIT,
  sources: [
    PARAGRAPH_CRLF_SOURCE,
    PARAGRAPH_LF_SOURCE,
    BLOCKQUOTE_CRLF_SOURCE,
    BLOCKQUOTE_LF_SOURCE,
  ],
});
