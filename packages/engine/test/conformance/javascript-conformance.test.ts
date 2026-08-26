import { javascriptAdapter } from '../../src/languages/javascript/adapter.js';
import { runAdapterConformance } from '../../src/conformance/run-adapter-conformance.js';

/**
 * The hard gate a second adapter's canary exists for: this is the
 * second adapter through the identical conformance suite Python already
 * passes (`./python-conformance.test.ts`). Every source below exercises
 * both comment forms this canary supports — `//` and JSDoc-style block
 * comments — each long enough to actually need wrapping at the
 * configured limit, so every wrap-based invariant (idempotency,
 * re-parse cleanliness, line length, line-ending preservation) is
 * exercised through both dissolve/emit paths, not just one.
 *
 * As with the Python suite, CRLF and LF variants of the same source are
 * both included so the line-ending invariant is checked both ways.
 *
 * If this file's suite passes, it confirms the hard gate this canary
 * exists to check: no engine change was needed to add this adapter
 * beyond what was already made, ahead of time, in the three commits
 * before the canary itself (comment dissolve/emit promoted to generic
 * modules, codeLikeKeywords split into descriptor data, wrapRegions
 * generalized). Those *were* engine changes the canary's design
 * surfaced — recorded in `docs/adapters.md`.
 */
const CRLF_SOURCE =
  'function computeTotal(prices) {\r\n' +
  '  // accumulate the running total across every item in the prices list argument\r\n' +
  '  let total = 0;\r\n' +
  '  for (const price of prices) {\r\n' +
  '    total += price;\r\n' +
  '  }\r\n' +
  '  /**\r\n' +
  '   * Returns the accumulated total, ready to be displayed or persisted by the caller.\r\n' +
  '   */\r\n' +
  '  return total;\r\n' +
  '}\r\n';

const LF_SOURCE = CRLF_SOURCE.replace(/\r\n/g, '\n');

runAdapterConformance(javascriptAdapter, {
  wasmDir: '.',
  columnLimit: 40,
  sources: [CRLF_SOURCE, LF_SOURCE],
});
