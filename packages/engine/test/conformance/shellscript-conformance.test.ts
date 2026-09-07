import { shellscriptAdapter } from '../../src/languages/shellscript/adapter.js';
import { runAdapterConformance } from '../../src/conformance/run-adapter-conformance.js';

/**
 * The hard gate the comment-only-batch languages exist to check —
 * Shell script (Bash) through the identical `runAdapterConformance` suite
 * every earlier adapter already passed. A shebang line (excluded from
 * reflow by `neverReflow`, per `../../src/languages/shellscript/descriptor.ts`),
 * a standalone `#` comment, and a comment trailing a command on the same
 * line are all exercised — every comment shape probed directly against
 * the grammar (`docs/spikes/tree-sitter-comment-langs-batch-probe.mjs`)
 * is covered by a real wrap.
 *
 * CRLF and LF variants of the same source are both included, matching
 * every earlier suite's own convention.
 *
 * If this file's suite passes, it confirms no engine change was needed to
 * add Bash beyond what the vendored grammar and this adapter's own
 * pure-data descriptor already provide — `shellscriptAdapter` declares no
 * `classify`/`groupRegions` override at all.
 */
const CRLF_SOURCE =
  '#!/bin/bash\r\n' +
  '# This is a standalone comment, long enough that it needs wrapping under a narrow limit\r\n' +
  'echo "hello" # a trailing comment, also long enough that it needs wrapping under a narrow limit\r\n';

const LF_SOURCE = CRLF_SOURCE.replace(/\r\n/g, '\n');

runAdapterConformance(shellscriptAdapter, {
  wasmDir: '.',
  columnLimit: 40,
  sources: [CRLF_SOURCE, LF_SOURCE],
});
