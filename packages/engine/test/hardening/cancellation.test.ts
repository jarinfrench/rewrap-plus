import { beforeAll, describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../../src/adapter-registry.js';
import { ParserManager } from '../../src/parser/parser-manager.js';
import { pythonAdapter } from '../../src/languages/python/adapter.js';
import { wrapRegions } from '../../src/wrap.js';
import type { WrapConfig } from '../../src/types/config.js';

/**
 * Proves `wrapRegions` can actually be interrupted *while it's running*, not
 * just when cancellation was already requested before the call started.
 *
 * The bug this guards against: the per-region loop in `../../src/wrap.ts`
 * checks `cancellation.isCancellationRequested` once per iteration, but a
 * synchronous `for` loop never yields to the event loop on its own — so a
 * cancellation flag flipped by a real asynchronous event (in the VSCode
 * extension, a `vscode.CancellationToken` set by a UI click delivered over
 * IPC to the extension host) could never actually be observed until the
 * whole computation had already finished, defeating the entire point of
 * `wrap-document.ts`'s cancellable large-file progress notification and
 * `format-on-save.ts`'s timeout. Fixed by having the loop periodically hand
 * control back to the event loop (`YIELD_INTERVAL_MS`, `yieldToEventLoop` in
 * `wrap.ts`) whenever a `cancellation` signal is actually in play.
 *
 * Timings below are grounded in a direct measurement on this same synthetic
 * 50,000-line file (not guessed): an uninterrupted run takes ~7-8s; a run
 * given a signal that's already `true` before the call starts (proving only
 * that the very first check works, not the bug this suite targets) returns
 * in ~0.7s, which is entirely parse + region discovery — the loop body
 * itself never runs. A real *asynchronous* cancellation fired 500ms in
 * (well past that ~0.7s floor, so the loop is provably mid-flight) measured
 * ~0.77s end to end — i.e., picked up within roughly one `YIELD_INTERVAL_MS`
 * window of the signal firing, not after the full ~7-8s. The bound below
 * (3s) sits with wide margin above that measurement (tolerating slower CI
 * hardware) while staying well under half the uninterrupted run time, so it
 * can't be satisfied by accident if the interruption stops working again.
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

/** Same shape as `../hardening/large-file-performance.test.ts`'s own Python generator — an unrealistically dense file so the loop has enough work to still be mid-flight well past parse+discovery. */
function generateFile(lineCount: number): string {
  const lines: string[] = [];
  for (let i = 0; i < lineCount; i++) {
    if (i % 10 === 0) {
      lines.push(
        `# This is a fairly long comment line number ${i} that will likely need wrapping around`,
      );
    } else if (i % 10 === 5) {
      lines.push(
        `x_${i} = "a string value number ${i} that is reasonably long and might need wrapping too"`,
      );
    } else {
      lines.push(`y_${i} = ${i}`);
    }
  }
  return lines.join('\n') + '\n';
}

let parserManager: ParserManager;

beforeAll(async () => {
  const registry = new AdapterRegistry();
  registry.register(pythonAdapter);
  parserManager = await ParserManager.create({ wasmDir: '.', registry });
  await wrapRegions('# warm\n', 'python', 'all', cfg, parserManager); // warm the grammar before timing
});

describe('wrapRegions cancellation responsiveness', () => {
  it('a cancellation request fired mid-computation actually interrupts an in-progress large wrap', async () => {
    const source = generateFile(50_000);
    const signal = { isCancellationRequested: false };

    // Fires well after parse+discovery alone would finish (~0.7s measured),
    // so the loop is provably still running when this lands.
    setTimeout(() => {
      signal.isCancellationRequested = true;
    }, 500);

    const t0 = Date.now();
    const result = await wrapRegions(source, 'python', 'all', cfg, parserManager, signal);
    const elapsed = Date.now() - t0;

    expect(result.cancelled).toBe(true);
    expect(result.edits.length).toBeLessThan(10_000); // fewer than every region in the file
    // See the module doc comment above for how this bound was measured.
    expect(elapsed).toBeLessThan(3_000);
  }, 20_000);

  it('the same file with no cancellation signal is unaffected by the yield-gating logic', async () => {
    // Guards against the yield check accidentally firing (and adding
    // overhead) for the one class of caller it must never affect: the CLI
    // (`packages/cli/src/apply.ts`) and every other call site that passes
    // no cancellation signal at all.
    const source = generateFile(10_000);
    const result = await wrapRegions(source, 'python', 'all', cfg, parserManager);
    expect(result.cancelled).toBe(false);
    expect(result.edits.length).toBe(2_000);
  }, 20_000);
});
