import { scssAdapter } from '../../src/languages/scss/adapter.js';
import { runAdapterConformance } from '../../src/conformance/run-adapter-conformance.js';

/**
 * The hard gate the comment-only-batch languages exist to check --
 * SCSS through the identical `runAdapterConformance` suite every earlier
 * adapter already passed. Every source below exercises both of SCSS's
 * comment node types -- a standalone `//` (`js_comment`) and a `/* * /`
 * (`comment`) -- each long enough to actually need wrapping, so the
 * two-node-type shape `../../src/languages/scss/descriptor.ts`'s own doc
 * comment documents (mirroring Java's `line_comment`/`block_comment`
 * split) is exercised through a real wrap, not just the descriptor's own
 * query compiling.
 *
 * CRLF and LF variants of the same source are both included, matching
 * every earlier suite's own convention.
 *
 * If this file's suite passes, it confirms no engine change was needed to
 * add SCSS beyond what the vendored grammar and this adapter's own
 * `classify` override (a pure node-type switch, no text-sniffing needed --
 * see `../../src/languages/scss/adapter.ts`'s own doc comment) already
 * provide.
 */
const CRLF_SOURCE =
  '// This is a standalone line comment, long enough that it needs wrapping under a narrow limit\r\n' +
  '/* This is a standalone block comment, long enough that it needs wrapping under a narrow limit */\r\n' +
  '.example {\r\n' +
  '  color: red; // a trailing line comment, also long enough that it needs wrapping under a narrow limit\r\n' +
  '}\r\n';

const LF_SOURCE = CRLF_SOURCE.replace(/\r\n/g, '\n');

runAdapterConformance(scssAdapter, {
  wasmDir: '.',
  columnLimit: 40,
  sources: [CRLF_SOURCE, LF_SOURCE],
});
