import { pythonAdapter } from '../../src/languages/python/adapter.js';
import { runAdapterConformance } from '../../src/conformance/run-adapter-conformance.js';

/**
 * The kit's own first real workout: run it against the adapter Phase 6
 * already shipped, before Phase 6b's canary JavaScript adapter exists to
 * prove genericity too. If this suite fails, the kit itself has a bug —
 * Python's line-comment wrapping already has its own dedicated gold
 * fixtures (`../wrap/python-comment-wrap-fixtures.test.ts`) passing
 * independently of this file.
 *
 * Two sources, identical content, differing only in line ending — CRLF
 * and LF — so the kit's own line-ending-preservation check
 * (`run-adapter-conformance.ts`) is exercised both ways, not just
 * against whichever convention this repository happens to use for its
 * own files.
 */
const CRLF_SOURCE =
  'def compute_total(prices):\r\n' +
  '    total = 0\r\n' +
  '    for price in prices:\r\n' +
  '        total += price  # accumulate the running total across every item in the list\r\n' +
  '    return total\r\n';

const LF_SOURCE = CRLF_SOURCE.replace(/\r\n/g, '\n');

runAdapterConformance(pythonAdapter, {
  wasmDir: '.',
  columnLimit: 40,
  sources: [CRLF_SOURCE, LF_SOURCE],
});
