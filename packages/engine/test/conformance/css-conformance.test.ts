import { cssAdapter } from '../../src/languages/css/adapter.js';
import { runAdapterConformance } from '../../src/conformance/run-adapter-conformance.js';

/**
 * The hard gate the comment-only-batch languages exist to check —
 * CSS through the identical `runAdapterConformance` suite every earlier
 * adapter already passed. A standalone `/* * /` comment and one trailing
 * a declaration inside a rule block are both exercised, each long enough
 * to actually need wrapping — the two shapes probed directly against the
 * grammar (`docs/spikes/tree-sitter-comment-langs-batch-probe.mjs`,
 * `docs/language-candidates.md`'s CSS row).
 *
 * CRLF and LF variants of the same source are both included, matching
 * every earlier suite's own convention.
 *
 * If this file's suite passes, it confirms no engine change was needed to
 * add CSS beyond what the vendored grammar and this adapter's own
 * `classify` override (needed because CSS has no line-comment form at
 * all — see `../../src/languages/css/descriptor.ts`'s own doc comment)
 * already provide.
 */
const CRLF_SOURCE =
  '/* This is a standalone comment, long enough that it needs wrapping under a narrow limit */\r\n' +
  '.example {\r\n' +
  '  color: red; /* a trailing comment, also long enough that it needs wrapping under a narrow limit */\r\n' +
  '}\r\n';

const LF_SOURCE = CRLF_SOURCE.replace(/\r\n/g, '\n');

runAdapterConformance(cssAdapter, {
  wasmDir: '.',
  columnLimit: 40,
  sources: [CRLF_SOURCE, LF_SOURCE],
});
