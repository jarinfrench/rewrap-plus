import { powershellAdapter } from '../../src/languages/powershell/adapter.js';
import { runAdapterConformance } from '../../src/conformance/run-adapter-conformance.js';

/**
 * The hard gate the comment-only-batch languages exist to check —
 * PowerShell through the identical `runAdapterConformance` suite every
 * earlier adapter already passed. Every source below exercises all three
 * of PowerShell's comment-node text shapes (`../../src/languages/powershell/
 * adapter.ts`'s own doc comment): a standalone `#` line comment, a plain
 * `<# ... #>` block comment, and a `<# ... #>` comment-based-help block
 * (`.SYNOPSIS`) — the last one specifically exercising the new
 * `'commentBasedHelp'` `DocDialectId` end to end, not just the
 * descriptor's own query compiling.
 *
 * CRLF and LF variants of the same source are both included, matching
 * every earlier suite's own convention.
 *
 * If this file's suite passes, it confirms no engine change was needed to
 * add PowerShell beyond what the vendored grammar, this adapter's own
 * `classify` override, and the new `commentBasedHelp` doc dialect
 * (`../../src/docs/comment-based-help.ts`) already provide.
 */
const CRLF_SOURCE =
  '<#\r\n' +
  '.SYNOPSIS\r\n' +
  'Does a thing, described in enough words that it needs wrapping under a narrow limit.\r\n' +
  '#>\r\n' +
  'function Get-Thing {\r\n' +
  '  # a standalone line comment, long enough that it needs wrapping under a narrow limit\r\n' +
  '  <# a plain block comment, also long enough that it needs wrapping under a narrow limit #>\r\n' +
  '  Write-Host "hi"\r\n' +
  '}\r\n';

const LF_SOURCE = CRLF_SOURCE.replace(/\r\n/g, '\n');

runAdapterConformance(powershellAdapter, {
  wasmDir: '.',
  columnLimit: 40,
  sources: [CRLF_SOURCE, LF_SOURCE],
});
