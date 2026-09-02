import { markdownAdapter } from '../../src/languages/markdown/adapter.js';
import { runAdapterConformance } from '../../src/conformance/run-adapter-conformance.js';

/**
 * Placeholder sources only as of this commit (Phase C commit 8,
 * `docs/planning/markdown-latex-plan.md` §9) — real content, and real
 * assertions about what gets wrapped, wait for commit 12 ("conformance,
 * idempotency glob, hardening and performance runs"), once
 * `markdownAdapter.discoverProse`/`wrapProse` (commits 9/10) actually
 * exist to discover and wrap a paragraph. Until then this suite runs
 * against zero discovered regions regardless of what these sources say —
 * `discoverRegions` only ever produces a `'prose'` region via
 * `adapter.discoverProse`, never from `queries.prose` alone (see
 * `docs/adapters.md`'s "every region is discovered by running a query"
 * finding) — so every wrap-based invariant here passes trivially on an
 * empty edit list. Kept as real (if inert) Markdown prose, not a literal
 * "TODO" string, so this file reads as a real placeholder rather than an
 * unfinished one.
 */
const COLUMN_LIMIT = 40;

const CRLF_SOURCE =
  'This is an ordinary Markdown paragraph, long enough that it will need\r\n' +
  'wrapping once real paragraph discovery and wrapping exist.\r\n';
const LF_SOURCE = CRLF_SOURCE.replace(/\r\n/g, '\n');

runAdapterConformance(markdownAdapter, {
  wasmDir: '.',
  columnLimit: COLUMN_LIMIT,
  sources: [CRLF_SOURCE, LF_SOURCE],
});
