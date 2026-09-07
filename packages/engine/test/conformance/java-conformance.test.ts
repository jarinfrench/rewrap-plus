import { javaAdapter } from '../../src/languages/java/adapter.js';
import { runAdapterConformance } from '../../src/conformance/run-adapter-conformance.js';

/**
 * The hard gate Phase 12f's own stretch-language work exists to check,
 * the same shape every earlier adapter's own conformance suite already
 * passed: this is the fifth adapter (after Python, JavaScript,
 * TypeScript/TSX, C++) through the identical suite. Every source below
 * exercises every comment form this adapter supports -- `//`, a plain
 * `/* * /`, and a Javadoc `/** * /` -- each long enough to actually need
 * wrapping at the configured limit, plus a `+`-concatenation string, so
 * every wrap-based invariant (idempotency, re-parse cleanliness, line
 * length, line-ending preservation) is exercised through every
 * dissolve/emit path this adapter has, not just one.
 *
 * As with every earlier suite, CRLF and LF variants of the same source
 * are both included so the line-ending invariant is checked both ways --
 * particularly relevant here given `./descriptor.ts`'s own finding that
 * Java's `line_comment` node reproduces the same CRLF trailing-`\r`
 * quirk Python's grammar has.
 *
 * If this file's suite passes, it confirms the hard gate every earlier
 * adapter's own conformance run already confirmed: no engine change was
 * needed to add Java beyond what the vendored grammar and this adapter's
 * own descriptor/classify/isSafeToWrap/wrapString already provide. See
 * `docs/adapters.md`'s Java section for the full write-up.
 */
const CRLF_SOURCE =
  'class Greeter {\r\n' +
  '  // computes a friendly greeting for the given name argument, used across the whole service\r\n' +
  '  String greet(String name) {\r\n' +
  '    /* a plain block comment with no Javadoc marker, long enough that it needs to wrap too */\r\n' +
  '    return "Hello, " + name;\r\n' +
  '  }\r\n' +
  '\r\n' +
  '  /**\r\n' +
  '   * Returns the accumulated greeting count, ready to be displayed or logged by the caller.\r\n' +
  '   */\r\n' +
  '  int count() {\r\n' +
  '    return 0;\r\n' +
  '  }\r\n' +
  '}\r\n';

const LF_SOURCE = CRLF_SOURCE.replace(/\r\n/g, '\n');

runAdapterConformance(javaAdapter, {
  wasmDir: '.',
  columnLimit: 40,
  sources: [CRLF_SOURCE, LF_SOURCE],
});
