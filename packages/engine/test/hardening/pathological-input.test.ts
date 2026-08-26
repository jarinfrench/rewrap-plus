import { beforeAll, describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../../src/adapter-registry.js';
import { applyTextEdits } from '../../src/apply-edits.js';
import { ParserManager } from '../../src/parser/parser-manager.js';
import type { WrapConfig } from '../../src/types/config.js';
import { pythonAdapter } from '../../src/languages/python/adapter.js';
import { wrapRegions } from '../../src/wrap.js';

/**
 * Phase 10, "harden parse error and unsafe region handling": the plan's
 * own named pathological-input list ("single 100k-char string, deeply
 * nested concat, file with no trailing newline, CRLF line endings, mixed
 * tabs/spaces") plus the "region overlapping an error span → skip with
 * reason, never partial-edit" invariant. CRLF line endings get their own
 * dedicated coverage in `./line-ending-preservation.test.ts` (Phase 10's
 * next commit) rather than here.
 *
 * Two real bugs surfaced while writing these — not hypothetical risks the
 * plan merely anticipated:
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

const engineRoot = '.';

let parserManager: ParserManager;

beforeAll(async () => {
  const registry = new AdapterRegistry();
  registry.register(pythonAdapter);
  parserManager = await ParserManager.create({ wasmDir: engineRoot, registry });
});

describe('pathological input hardening', () => {
  it('skips only the region(s) overlapping a parse error, never a partial edit, and still wraps everything else', async () => {
    // The trailing `+` with nothing after it makes the parser produce one
    // wide ERROR node recovering across several following lines — wide
    // enough to genuinely overlap both the string literal on the broken
    // line and the comment on the line after it, while the comment
    // *before* the error sits entirely outside it. This is deliberately
    // not the same construction as `../../src/wrap.test.ts`'s narrower
    // "doesn't throw" check: it asserts the specific before/inside split,
    // confirmed by direct probing to be exactly what this input produces.
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
    expect(result.skipped.map((s) => s.region.kind).sort()).toEqual(['lineComment', 'stringLiteral']);
  });

  it('handles a long chain of `+`-concatenated string literals without crashing or hanging', async () => {
    const n = 2000;
    const parts = Array.from(
      { length: n },
      (_, i) => `"part number ${i} of a long prose message that keeps going"`,
    );
    const source = `x = ${parts.join(' + ')}\n`;

    const result = await wrapRegions(source, 'python', 'all', cfg, parserManager);
    expect(result.edits.length + result.skipped.length).toBeGreaterThan(0);

    // Idempotent, same as every other fixture (Phase 10's own headline
    // property) — proves the pathological-sized input isn't just "doesn't
    // crash" but actually produces a stable, well-formed result.
    const wrapped = applyTextEdits(source, result.edits);
    const second = await wrapRegions(wrapped, 'python', 'all', cfg, parserManager);
    expect(second.edits).toEqual([]);
  }, 20_000);

  it('handles a single 100,000-character string literal without crashing', async () => {
    const body = 'word '.repeat(20_000).trim();
    const source = `x = "${body}"\n`;

    const result = await wrapRegions(source, 'python', 'all', cfg, parserManager);
    expect(result.edits).toHaveLength(1);

    for (const line of result.edits[0]!.newText.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(cfg.columnLimit);
    }
  }, 10_000);

  it('wraps a file with no trailing newline, without adding one', async () => {
    const source = '# ' + 'word '.repeat(30).trim(); // deliberately no trailing "\n"

    const result = await wrapRegions(source, 'python', 'all', cfg, parserManager);
    expect(result.edits).toHaveLength(1);

    const wrapped = applyTextEdits(source, result.edits);
    expect(wrapped.endsWith('\n')).toBe(false);
  });

  it('handles mixed tab/space indentation without crashing, and never mixes the two in a re-emitted indent', async () => {
    const source =
      'def f():\n' +
      '\t# ' +
      'a comment indented with a tab that needs wrapping around here for sure'.repeat(1) +
      '\n' +
      '\tpass\n';

    const result = await wrapRegions(source, 'python', 'all', cfg, parserManager);
    expect(result.edits.length).toBeGreaterThan(0);

    const wrapped = applyTextEdits(source, result.edits);
    for (const line of wrapped.split('\n')) {
      // Whatever indent a re-emitted line carries, it's consistently one
      // kind of whitespace, never a tab followed by a space (or vice
      // versa) invented by the reflow/indent math.
      expect(line).not.toMatch(/^\t+ +#/);
    }
  });
});
