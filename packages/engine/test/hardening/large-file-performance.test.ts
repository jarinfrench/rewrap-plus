import { beforeAll, describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../../src/adapter-registry.js';
import { ParserManager } from '../../src/parser/parser-manager.js';
import type { WrapConfig } from '../../src/types/config.js';
import { pythonAdapter } from '../../src/languages/python/adapter.js';
import { wrapRegions } from '../../src/wrap.js';

/**
 * Performance benchmarks and large-file guardrails — the engine-side
 * half. `docs/benchmarks.md` documents the actual measured numbers this
 * test's thresholds are derived from, and the two real quadratic-cost
 * bugs the benchmarking work in this commit found and fixed
 * (`sliceSpanText`'s and `detectLineEndingNear`'s own doc comments
 * carry the full detail):
 *
 * - `sliceSpanText` re-split the entire file on every call — called at
 *   least once per region — making "wrap every region in the file"
 *   quadratic in file size.
 * - `detectLineEndingNear` (added earlier in this same phase) had the
 *   identical bug from the moment it was introduced.
 *
 * These are regression guards, not a micro-benchmark harness: generous
 * upper bounds with real headroom, so ordinary machine variance and
 * future feature work don't make this test flaky, while still catching
 * a *class* of regression (a reintroduced quadratic cost) that would
 * blow through them by an order of magnitude, the way both bugs above
 * did before they were fixed.
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

let parserManager: ParserManager;

beforeAll(async () => {
  const registry = new AdapterRegistry();
  registry.register(pythonAdapter);
  parserManager = await ParserManager.create({ wasmDir: '.', registry });
});

/**
 * A synthetic file with an unrealistically *high* density of wrappable
 * regions (every 5th line, alternating comment/string) — real code wraps
 * a much smaller fraction of its lines, so this is deliberately a worse
 * case than any real file of the same line count, giving the time bounds
 * below real margin rather than being tuned to just barely pass.
 */
function generateFile(lineCount: number): string {
  const lines: string[] = [];
  for (let i = 0; i < lineCount; i++) {
    if (i % 10 === 0) {
      lines.push(`# This is a fairly long comment line number ${i} that will likely need wrapping around`);
    } else if (i % 10 === 5) {
      lines.push(`x_${i} = "a string value number ${i} that is reasonably long and might need wrapping too"`);
    } else {
      lines.push(`y_${i} = ${i}`);
    }
  }
  return lines.join('\n') + '\n';
}

describe('large-file performance', () => {
  it('wraps a 1,000-line file in well under a second', async () => {
    const source = generateFile(1_000);
    const t0 = Date.now();
    await wrapRegions(source, 'python', 'all', cfg, parserManager);
    expect(Date.now() - t0).toBeLessThan(1_000);
  });

  it('wraps a 10,000-line file in a few seconds', async () => {
    const source = generateFile(10_000);
    const t0 = Date.now();
    await wrapRegions(source, 'python', 'all', cfg, parserManager);
    expect(Date.now() - t0).toBeLessThan(5_000);
  }, 20_000);

  it('wraps a 50,000-line file without the quadratic blowup this phase found and fixed', async () => {
    // Measured ~7s after the fix (docs/benchmarks.md) vs. ~60s before —
    // the bound here is set well above the fixed number and well below
    // the regressed one, so this fails loudly if either bug's class of
    // cost (or a similar one) comes back.
    const source = generateFile(50_000);
    const t0 = Date.now();
    await wrapRegions(source, 'python', 'all', cfg, parserManager);
    expect(Date.now() - t0).toBeLessThan(20_000);
  }, 60_000);

  it('wraps a single region near the cursor in a large file near-instantly, independent of file size', async () => {
    // The stated budget: "wrap-at-cursor should feel instant (< 50 ms
    // after warm grammar load)." A generous 200ms bound (this
    // machine's own measured number was ~30ms) rather than literally 50 —
    // CI hardware varies, and the property under test is "independent of
    // file size," not a tight latency SLA.
    const source = generateFile(5_000);
    await wrapRegions('# warm up\n', 'python', 'all', cfg, parserManager); // warm the grammar first

    const target = [
      { startByte: 0, endByte: 1, startRow: 0, startColumn: 0, endRow: 0, endColumn: 1 },
    ];
    const t0 = Date.now();
    await wrapRegions(source, 'python', target, cfg, parserManager);
    expect(Date.now() - t0).toBeLessThan(200);
  });
});
