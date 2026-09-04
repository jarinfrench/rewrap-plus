import type { LanguageAdapter } from '../../src/types/adapter.js';
import type { WrappableRegion } from '../../src/types/region.js';
import { dissolveProse } from '../../src/prose/dissolve-prose.js';
import { emitProse } from '../../src/prose/emit-prose.js';
import { runAdapterConformance } from '../../src/conformance/run-adapter-conformance.js';

/**
 * A synthetic, `discoverProse`/`wrapProse`-only adapter — no real
 * language, built purely to run `runAdapterConformance` against a
 * `'prose'`-producing adapter for real, ahead of a real one (Markdown/
 * LaTeX, Phase C/D) existing.
 * Phase B commit 6 taught the conformance kit three things about prose
 * adapters — compiling `queries.prose` when declared, generalized
 * "at least one region overflows" fixture wording, and a loosened
 * line-length decoration check for a `'prose'` region's own continuation
 * prefix (`../../src/conformance/run-adapter-conformance.ts`'s
 * `stripKnownCommentDecoration`) — and the last of those three is
 * exercised by nothing else in this test suite, since every real adapter
 * so far is comment/string-only. This fixture exists to prove the kit
 * itself works against a real `discoverProse`/`wrapProse`
 * implementation, not to model a real language.
 *
 * Declares **no** `queries.comments`/`.strings`/`.prose` at all —
 * mirroring LaTeX's own real shape (masked-line-scan discovery, no query
 * to run at all) more closely than Markdown's query-driven one, and
 * conveniently also the
 * shape that most directly needs `validateDescriptor`'s `hasDiscoverProse`
 * escape hatch (commit 4) to pass at all.
 *
 * `discoverProse` finds one region: every line strictly between a bare
 * `/*` and a bare `*\/` line (a C-family block comment, parsed by the
 * real vendored `tree-sitter-cpp` grammar so the source parses with zero
 * errors regardless of what prose text sits inside it — block-comment
 * *contents* are never re-lexed as code) — stripping a leading `'> '`
 * from each inner line as its container prefix, the same per-line
 * contract §3.2 describes for a real adapter (a "lazy" line with no
 * prefix at all is handled the same way: nothing to strip). `wrapProse`
 * re-emits that exact `'> '` as its `continuationPrefix` — chosen
 * specifically (over, say, plain spaces) to exercise the new loosened
 * `[> \t]*` strip — with no need for it to *also* keep the file
 * syntactically valid, since a block comment's own delimiters (never
 * touched by the region's `span`) are what do that job, not anything
 * about the reflowed content itself. Round-tripping the same prefix
 * through both hooks (discover strips it, wrap re-emits it) is what
 * makes a second wrap pass over already-wrapped output idempotent,
 * rather than re-atomizing a previous pass's own `'> '` as literal text.
 */
function discoverBlockCommentProse(source: string, languageId: string): WrappableRegion[] {
  const lines = source.split('\n');
  const openRow = lines.findIndex((line) => line.trim() === '/*');
  const closeRow = lines.findIndex((line, index) => index > openRow && line.trim() === '*/');
  if (openRow === -1 || closeRow === -1 || closeRow <= openRow + 1) {
    return [];
  }

  const parts = [];
  for (let row = openRow + 1; row < closeRow; row++) {
    const line = lines[row]!;
    // Strip a leading '> ' — the same canonical prefix `wrapProse` below
    // re-emits on every continuation line — so a second wrap pass over
    // already-wrapped output treats it as the container prefix it is,
    // not as literal content. A "lazy" line with no prefix at all (never
    // produced by this fixture's own `wrapProse`, but the real per-line
    // contract §3.2 describes) is handled the same way Markdown's is:
    // simply no prefix to strip.
    const startColumn = line.startsWith('> ') ? 2 : 0;
    // `source.split('\n')` leaves a lone trailing '\r' as part of each
    // line's text on CRLF input — the same quirk `discover-regions.ts`'s
    // `trimTrailingCR` exists for on the real, grammar-backed path.
    // Without this, that stray '\r' rides along as part of each line's
    // last atom (`atomizeWords` doesn't treat '\r' as whitespace), which
    // is exactly the kind of contamination a `WrappableRegion.span` used
    // as an editing source must never carry.
    const endColumn = line.endsWith('\r') ? line.length - 1 : line.length;
    parts.push({
      startByte: 0,
      endByte: 0,
      startRow: row,
      startColumn,
      endRow: row,
      endColumn,
    });
  }
  const first = parts[0]!;
  const last = parts[parts.length - 1]!;

  return [
    {
      kind: 'prose',
      span: {
        startByte: 0,
        endByte: 0,
        startRow: first.startRow,
        startColumn: first.startColumn,
        endRow: last.endRow,
        endColumn: last.endColumn,
      },
      parts,
      rawText: lines.slice(openRow + 1, closeRow).join('\n'),
      // Matches continuationPrefix's own width ('> ', 2 columns) below —
      // emitProse's single availableWidth = columnLimit - indentColumn
      // is only correct when the two coincide (see that function's own
      // doc comment on why); a real adapter's continuationPrefix is
      // *derived from* indentColumn for exactly this reason (§5.3), so a
      // mismatch here would be this fixture's own bug, not a real one.
      indentColumn: 2,
      languageId,
    },
  ];
}

const fakeProseAdapter: LanguageAdapter = {
  descriptor: {
    id: 'fake-prose',
    grammarWasm: 'grammars/tree-sitter-cpp.wasm',
    queries: {},
    comments: { neverReflow: [] },
  },
  discoverProse: (_tree, source, languageId) => discoverBlockCommentProse(source, languageId),
  wrapProse: (region, source, cfg) => {
    // No `hardBreak` patterns: this kit's own conformance sources are
    // deliberately kept free of two-space hard breaks (see the
    // trailing-whitespace invariant's own doc comment in
    // `run-adapter-conformance.ts`) — that real trailing whitespace is
    // tested for real by a prose adapter's own gold fixtures instead.
    const document = dissolveProse(region, source, { hardBreak: [] });
    return emitProse(document, cfg.columnLimit, { continuationPrefix: '> ' });
  },
};

/**
 * A block comment whose inner prose is long enough to need wrapping
 * under a narrow column limit, plus one line that's a single long
 * "unbreakable" run (no internal whitespace) — long enough to overflow
 * even alone on its own reflowed line, so the "no reflowed line over the
 * limit except a lone unbreakable atom" invariant actually has to run
 * `stripKnownCommentDecoration` against a `'> '`-prefixed continuation
 * line and confirm the loosened check strips it correctly, rather than
 * passing trivially because nothing ever overflowed.
 */
const CRLF_SOURCE =
  '/*\r\n' +
  'this is quite a long line of prose content that will need wrapping for sure\r\n' +
  'a-single-unbreakable-run-with-no-internal-whitespace-anywhere-in-it-at-all-so-it-must-overflow-alone\r\n' +
  'and a short line after it\r\n' +
  '*/\r\n' +
  'int x = 1;\r\n';

const LF_SOURCE = CRLF_SOURCE.replace(/\r\n/g, '\n');

runAdapterConformance(fakeProseAdapter, {
  wasmDir: '.',
  columnLimit: 40,
  sources: [CRLF_SOURCE, LF_SOURCE],
});
