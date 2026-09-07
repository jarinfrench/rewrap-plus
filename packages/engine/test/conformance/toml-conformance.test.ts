import { tomlAdapter } from '../../src/languages/toml/adapter.js';
import { runAdapterConformance } from '../../src/conformance/run-adapter-conformance.js';

/**
 * The hard gate the comment-only-batch languages exist to check, the
 * same shape every earlier adapter's own conformance suite already
 * passed -- TOML through this identical suite alongside Python,
 * JavaScript, TypeScript/TSX, C++, Java, Markdown, LaTeX. Both a
 * standalone `#` comment and one trailing a `key = "value"` pair are
 * exercised, each long enough to actually need wrapping at the
 * configured limit, so both shapes probed directly against the grammar
 * (`docs/spikes/tree-sitter-comment-langs-batch-probe.mjs`,
 * `docs/language-candidates.md`'s TOML row) are covered by a real wrap.
 *
 * CRLF and LF variants of the same source are both included so the
 * line-ending invariant is checked both ways, matching every earlier
 * suite's own convention.
 *
 * If this file's suite passes, it confirms no engine change was needed
 * to add TOML beyond what the vendored grammar and this adapter's own
 * pure-data descriptor already provide -- `tomlAdapter` declares no
 * `classify`/`groupRegions` override at all.
 */
const CRLF_SOURCE =
  '# This is a standalone comment, long enough that it needs wrapping under a narrow limit\r\n' +
  'title = "Example"\r\n' +
  '\r\n' +
  '[package]\r\n' +
  'name = "demo" # a trailing comment, also long enough that it needs wrapping under a narrow limit\r\n' +
  'version = "1.0"\r\n';

const LF_SOURCE = CRLF_SOURCE.replace(/\r\n/g, '\n');

runAdapterConformance(tomlAdapter, {
  wasmDir: '.',
  columnLimit: 40,
  sources: [CRLF_SOURCE, LF_SOURCE],
});
