import { cppAdapter } from '../../src/languages/cpp/adapter.js';
import { runAdapterConformance } from '../../src/conformance/run-adapter-conformance.js';

/**
 * The C++ adapter through the identical conformance suite Python,
 * JavaScript, TypeScript, and TSX already pass — see
 * `./javascript-conformance.test.ts` for the same rationale. Sources
 * below exercise `//`, Doxygen-shaped `/**`, and a bare-adjacency string
 * concatenation, each long enough to need wrapping at the configured
 * limit.
 */
const CRLF_SOURCE =
  'int computeTotal(const int* prices, int count) {\r\n' +
  '  // accumulate the running total across every price in the given prices array\r\n' +
  '  int total = 0;\r\n' +
  '  for (int i = 0; i < count; ++i) {\r\n' +
  '    total += prices[i];\r\n' +
  '  }\r\n' +
  '  /**\r\n' +
  '   * Returns the accumulated total, ready to be displayed or persisted by the caller.\r\n' +
  '   */\r\n' +
  '  return total;\r\n' +
  '}\r\n';

const LF_SOURCE = CRLF_SOURCE.replace(/\r\n/g, '\n');

runAdapterConformance(cppAdapter, {
  wasmDir: '.',
  columnLimit: 40,
  sources: [CRLF_SOURCE, LF_SOURCE],
});
