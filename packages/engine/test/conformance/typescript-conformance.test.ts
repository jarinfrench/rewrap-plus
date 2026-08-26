import { typescriptAdapter } from '../../src/languages/typescript/adapter.js';
import { runAdapterConformance } from '../../src/conformance/run-adapter-conformance.js';

/**
 * Phase 12b's own adapter through the identical conformance suite Python
 * and JavaScript already pass — see `./javascript-conformance.test.ts`
 * for the same rationale. Sources below exercise `//`, JSDoc-shaped
 * `/**`, and a type-annotated function, each long enough to need
 * wrapping at the configured limit.
 */
const CRLF_SOURCE =
  'function computeTotal(prices: number[]): number {\r\n' +
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

runAdapterConformance(typescriptAdapter, {
  wasmDir: '.',
  columnLimit: 40,
  sources: [CRLF_SOURCE, LF_SOURCE],
});
