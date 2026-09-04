import { beforeAll, describe, expect, it } from 'vitest';
import { createTestParserManager } from '../helpers/create-test-parser-manager.js';
import { applyTextEdits } from '../../src/apply-edits.js';
import { ParserManager } from '../../src/parser/parser-manager.js';
import type { WrapConfig } from '../../src/types/config.js';
import type { LanguageAdapter } from '../../src/types/adapter.js';
import { pythonAdapter } from '../../src/languages/python/adapter.js';
import { javascriptAdapter } from '../../src/languages/javascript/adapter.js';
import { typescriptAdapter } from '../../src/languages/typescript/adapter.js';
import { cppAdapter } from '../../src/languages/cpp/adapter.js';
import { javaAdapter } from '../../src/languages/java/adapter.js';
import { wrapRegions } from '../../src/wrap.js';

/**
 * Hardening parse error and unsafe region handling: a named
 * pathological-input list ("single 100k-char string, deeply nested
 * concat, file with no trailing newline, CRLF line endings, mixed
 * tabs/spaces") plus the "region overlapping an error span → skip with
 * reason, never partial-edit" invariant. CRLF line endings get their own
 * dedicated coverage in `./line-ending-preservation.test.ts` rather than
 * here.
 *
 * Four of the five named cases below are parameterized across every
 * registered adapter — the same Python-only gap `../wrap/idempotency-all-
 * fixtures.test.ts` and `./line-ending-preservation.test.ts` had before
 * being generalized. The fifth (the parse-error-overlap test) stays
 * Python-only; see its own doc comment for why that's a deliberate scope
 * line, not an oversight.
 *
 * Two real bugs surfaced while writing the original Python-only version of
 * this suite — not hypothetical risks merely anticipated in advance:
 *
 * - `parseWithErrors`' `collectErrorSpans` and `discoverRegions`'
 *   `collectOperatorChainLeaves` were both recursive, one call frame per
 *   tree node/operator. A long chain of `+`-concatenated string literals
 *   (real Python, `tree-sitter-python` parses it without complaint) builds
 *   a `binary_operator` tree whose depth scales with operand count, and a
 *   several-thousand-operand chain blew the actual JS call stack
 *   (`RangeError: Maximum call stack size exceeded`) in both functions —
 *   confirmed by direct probing before any fix existed. Both are now
 *   iterative (explicit stack), removing the depth limit entirely; see
 *   each function's own doc comment (`../../src/parser/parse-result.ts`,
 *   `../../src/discovery/discover-regions.ts`).
 * - `PositionMapper#byteOffsetToPosition`/`#positionToByteOffset` scanned
 *   every query from the start of the line, making each call cost
 *   `O(line length)` — paid at least once per discovered node. A single
 *   very long line (exactly what a long `+`-chain or one huge string
 *   literal produces) turned "discover every region in the file"
 *   quadratic in that line's length: a 20,000-operand chain on one line
 *   took over two minutes before the fix below. `PositionMapper` now
 *   keeps a per-line checkpoint table (`../../src/types/position-mapper.ts`)
 *   so each call costs `O(CHECKPOINT_INTERVAL)` instead.
 *
 * What's left un-fixed and documented rather than chased further: with
 * both bugs above fixed, the remaining cost of discovering a many-
 * -thousand-operand concatenation chain is dominated by `web-tree-sitter`'s
 * own `Query#captures` matching a recursive `@concat.operator` pattern
 * against a deeply left-associative tree — confirmed by direct timing to
 * be the actual bottleneck (not this package's own code) once the two
 * fixes above landed, and a third-party/grammar-level characteristic, not
 * something to patch inside this engine. It degrades gracefully (slow,
 * not crashing) rather than being fully linear; the test below picks a
 * size that stays well within a CI-reasonable budget while still being
 * far larger than any realistic hand-written chain.
 *
 * That same probing (`docs/spikes/probe-concat-depth.mjs`) found the
 * *shape* of the pathology is specific to `'operator'`-style
 * concatenation (Python's `+` form, and JS/TS/Java's only form): a 2,000-
 * part chain built a `binary_operator`/`binary_expression` tree ~2,000
 * nodes deep for all three. C++'s `'implicit'`-only concatenation (bare
 * adjacency, no operator) is structurally immune — the identical 2,000-
 * part chain produced a tree only 8 nodes deep, because
 * `tree-sitter-cpp`'s `concatenated_string` node holds every adjacent
 * literal as a flat list of children, not a recursive binary tree. The
 * C++ variant of that test below is kept anyway as a permanent regression
 * guard (if that flat representation ever changed, or this engine's own
 * discovery logic grew a recursive step over it, this would catch it) —
 * it's just not exercising the same pathology the other four languages
 * share.
 */
const cfg: WrapConfig = {
  columnLimit: 60,
  tabSize: 4,
  wrapComments: true,
  wrapStrings: true,
  stringPolicy: 'prose',
  docDialect: 'auto',
  preserveIndentedBlocks: true,
  balancedWrapping: false,
};

interface LanguageSet {
  readonly languageId: string;
  readonly adapter: LanguageAdapter;
  readonly commentMarker: string;
  /** `n` adjacent/`+`-joined string-literal parts, wrapped in whatever context this language needs. */
  readonly buildLongChainSource: (parts: readonly string[]) => string;
  /** A single large string literal, wrapped in whatever context this language needs. */
  readonly buildLargeStringSource: (body: string) => string;
  /** A tab-indented comment inside a block, wrapped in whatever context this language needs. */
  readonly buildMixedTabSpaceSource: (comment: string) => string;
}

const LANGUAGE_SETS: readonly LanguageSet[] = [
  {
    languageId: 'python',
    adapter: pythonAdapter,
    commentMarker: '#',
    buildLongChainSource: (parts) => `x = ${parts.join(' + ')}\n`,
    buildLargeStringSource: (body) => `x = "${body}"\n`,
    buildMixedTabSpaceSource: (comment) => `def f():\n\t${comment}\n\tpass\n`,
  },
  {
    languageId: 'javascript',
    adapter: javascriptAdapter,
    commentMarker: '//',
    buildLongChainSource: (parts) => `const x = ${parts.join(' + ')};\n`,
    buildLargeStringSource: (body) => `const x = "${body}";\n`,
    buildMixedTabSpaceSource: (comment) => `function f() {\n\t${comment}\n\tx = 1;\n}\n`,
  },
  {
    languageId: 'typescript',
    adapter: typescriptAdapter,
    commentMarker: '//',
    buildLongChainSource: (parts) => `const x = ${parts.join(' + ')};\n`,
    buildLargeStringSource: (body) => `const x = "${body}";\n`,
    buildMixedTabSpaceSource: (comment) => `function f() {\n\t${comment}\n\tx = 1;\n}\n`,
  },
  {
    languageId: 'cpp',
    adapter: cppAdapter,
    commentMarker: '//',
    // Bare adjacency, not `+` — C++'s only concatenation form (see module
    // doc comment on why this doesn't reproduce the same tree-depth
    // pathology the other four languages do).
    buildLongChainSource: (parts) => `void f() {\n  const char* x = ${parts.join(' ')};\n}\n`,
    buildLargeStringSource: (body) => `void f() {\n  const char* x = "${body}";\n}\n`,
    buildMixedTabSpaceSource: (comment) => `void f() {\n\t${comment}\n\tint x = 1;\n}\n`,
  },
  {
    languageId: 'java',
    adapter: javaAdapter,
    commentMarker: '//',
    buildLongChainSource: (parts) => `class C {\n  String x = ${parts.join(' + ')};\n}\n`,
    buildLargeStringSource: (body) => `class C {\n  String x = "${body}";\n}\n`,
    buildMixedTabSpaceSource: (comment) =>
      `class C {\n  void f() {\n\t${comment}\n\tint x = 1;\n  }\n}\n`,
  },
];

let parserManager: ParserManager;

beforeAll(async () => {
  parserManager = await createTestParserManager(LANGUAGE_SETS.map(({ adapter }) => adapter));
});

describe('pathological input hardening (python only — see module doc comment)', () => {
  it('skips only the region(s) overlapping a parse error, never a partial edit, and still wraps everything else', async () => {
    // The trailing `+` with nothing after it makes the parser produce one
    // wide ERROR node recovering across several following lines — wide
    // enough to genuinely overlap both the string literal on the broken
    // line and the comment on the line after it, while the comment
    // *before* the error sits entirely outside it. This is deliberately
    // not the same construction as `../../src/wrap.test.ts`'s narrower
    // "doesn't throw" check: it asserts the specific before/inside split,
    // confirmed by direct probing to be exactly what this input produces.
    //
    // Kept Python-only rather than replicated across every adapter: the
    // *shape* an ERROR node's recovery takes after a trailing binary
    // operator is a genuine per-grammar characteristic (this project's own
    // "assume every grammar has its own version of this waiting to be
    // found" rule), not something safe to assume generalizes from one
    // probed construction. The underlying invariant this test protects —
    // "a region overlapping any parse error is skipped, never partially
    // edited" — is still exercised for every adapter by
    // `run-adapter-conformance.ts`'s "wrapped output re-parses with zero
    // error nodes" check and by this file's own now-generalized pathological
    // cases below; what's Python-only here is specifically this one
    // hand-probed before/inside split, not the invariant itself.
    const source =
      '# valid comment before the error, definitely long enough to need wrapping around\n' +
      'x = "a valid string that is long enough to need wrapping" +\n' +
      '# valid after, long enough to wrap around here for sure\n' +
      'y = 1\n';

    const result = await wrapRegions(source, 'python', 'all', cfg, parserManager);

    expect(result.edits).toHaveLength(1);
    expect(result.edits[0]!.span.startRow).toBe(0); // only the comment before the error

    expect(result.skipped).toHaveLength(2);
    for (const skipped of result.skipped) {
      expect(skipped.reason).toBe('region overlaps a parse error');
    }
    expect(result.skipped.map((s) => s.region.kind).sort()).toEqual([
      'lineComment',
      'stringLiteral',
    ]);
  });
});

describe.each(LANGUAGE_SETS)(
  'pathological input hardening ($languageId)',
  ({
    languageId,
    buildLongChainSource,
    buildLargeStringSource,
    buildMixedTabSpaceSource,
    commentMarker,
  }) => {
    it('handles a long chain of concatenated string literals without crashing or hanging', async () => {
      const n = 2000;
      const parts = Array.from(
        { length: n },
        (_, i) => `"part number ${i} of a long prose message that keeps going"`,
      );
      const source = buildLongChainSource(parts);

      const result = await wrapRegions(source, languageId, 'all', cfg, parserManager);
      expect(result.edits.length + result.skipped.length).toBeGreaterThan(0);

      // Idempotent, same as every other fixture (this suite's own headline
      // property) — proves the pathological-sized input isn't just "doesn't
      // crash" but actually produces a stable, well-formed result.
      const wrapped = applyTextEdits(source, result.edits);
      const second = await wrapRegions(wrapped, languageId, 'all', cfg, parserManager);
      expect(second.edits).toEqual([]);
    }, 20_000);

    it('handles a single 100,000-character string literal without crashing', async () => {
      const body = 'word '.repeat(20_000).trim();
      const source = buildLargeStringSource(body);

      const result = await wrapRegions(source, languageId, 'all', cfg, parserManager);
      expect(result.edits).toHaveLength(1);

      for (const line of result.edits[0]!.newText.split('\n')) {
        expect(line.length).toBeLessThanOrEqual(cfg.columnLimit);
      }
    }, 10_000);

    it('wraps a file with no trailing newline, without adding one', async () => {
      const source = `${commentMarker} ` + 'word '.repeat(30).trim(); // deliberately no trailing "\n"

      const result = await wrapRegions(source, languageId, 'all', cfg, parserManager);
      expect(result.edits).toHaveLength(1);

      const wrapped = applyTextEdits(source, result.edits);
      expect(wrapped.endsWith('\n')).toBe(false);
    });

    it('handles mixed tab/space indentation without crashing, and never mixes the two in a re-emitted indent', async () => {
      const comment =
        `${commentMarker} ` +
        'a comment indented with a tab that needs wrapping around here for sure';
      const source = buildMixedTabSpaceSource(comment);

      const result = await wrapRegions(source, languageId, 'all', cfg, parserManager);
      expect(result.edits.length).toBeGreaterThan(0);

      const wrapped = applyTextEdits(source, result.edits);
      const markerEscaped = commentMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const mixedIndentPattern = new RegExp(`^\\t+ +${markerEscaped}`);
      for (const line of wrapped.split('\n')) {
        // Whatever indent a re-emitted line carries, it's consistently one
        // kind of whitespace, never a tab followed by a space (or vice
        // versa) invented by the reflow/indent math.
        expect(line).not.toMatch(mixedIndentPattern);
      }
    });
  },
);
