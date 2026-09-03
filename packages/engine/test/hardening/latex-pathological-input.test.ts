import { beforeAll, describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../../src/adapter-registry.js';
import { applyTextEdits } from '../../src/apply-edits.js';
import { ParserManager } from '../../src/parser/parser-manager.js';
import type { WrapConfig } from '../../src/types/config.js';
import { latexAdapter } from '../../src/languages/latex/adapter.js';
import { wrapRegions } from '../../src/wrap.js';

/**
 * LaTeX's own named worst cases — `docs/planning/markdown-latex-plan.md`
 * §8.4/§10 — genuinely different pathologies from
 * `./pathological-input.test.ts`'s comment/string-language ones and from
 * `./markdown-pathological-input.test.ts`'s own Markdown-specific ones,
 * because LaTeX's `discoverProse` is a masked line scan with its own
 * distinct cost shapes: `buildRowMasks`'s `isRowMasked` does an `O(masks)`
 * scan *per row* (flagged as a real, not-yet-measured concern during this
 * commit's own pre-work review — this suite is what resolves it, not
 * assumption), and `buildEnumItemStartColumns`/`buildHeaderSpansByStartRow`
 * each do their own whole-tree `descendantsOfType` walk.
 *
 * All four were measured, not merely assumed safe — `docs/benchmarks.md`
 * records the actual numbers this suite's own comments quote. The
 * many-small-regions case (5,000 separate `\item`s) is a genuinely
 * different, slower cost shape than the one-giant-region case (a
 * 10,000-line single paragraph): each `\item` is its own `wrapLatexProse`
 * call, not a slice of one shared reflow — confirmed *linear* in region
 * count, not quadratic, by direct measurement across several sizes, not
 * assumed safe just because no single step looks expensive in isolation.
 */
const cfg: WrapConfig = {
  columnLimit: 60,
  tabSize: 4,
  wrapComments: true,
  wrapStrings: true,
  stringPolicy: 'off',
  docDialect: 'auto',
  preserveIndentedBlocks: false,
  balancedWrapping: false,
};

const engineRoot = '.';

let parserManager: ParserManager;

beforeAll(async () => {
  const registry = new AdapterRegistry();
  registry.register(latexAdapter);
  parserManager = await ParserManager.create({ wasmDir: engineRoot, registry });
});

describe('LaTeX pathological input hardening', () => {
  it('handles 2,000 small masked environments interspersed with prose without quadratic slowdown', async () => {
    // Measured ~1.4-1.5s in isolation — recorded in docs/benchmarks.md.
    // Directly resolves the `isRowMasked` `O(masks)`-per-row concern
    // flagged during this commit's own review: 2,000 separate `verbatim`
    // environments means 2,000 row-mask entries, and every one of the
    // file's ~10,000 rows checks against all of them — the worst
    // realistic shape for that function's linear scan. A separate
    // scaling check (500/1,000/2,000/4,000/8,000 items, not committed as
    // its own test — a one-off run while investigating this suite's own
    // timings) confirmed cost-per-region *falls*, not rises, as the
    // count grows — the opposite of what a quadratic `isRowMasked` scan
    // would produce. The bound below is intentionally far wider than the
    // isolated measurement (confirmed to genuinely need it: this exact
    // test measured over 8s once, running inside the full suite
    // alongside every other CPU-bound hardening/performance test at
    // once — a real contention effect, not a regression, reproduced by
    // rerunning this file alone afterward and seeing it back at ~1.4s) —
    // this is a regression guard against a *quadratic*-shaped blowup,
    // not a tight latency SLA, matching `./large-file-performance.test.ts`'s
    // own stated philosophy.
    const parts: string[] = [];
    for (let i = 0; i < 2_000; i++) {
      parts.push(`Paragraph number ${i} has enough words in it to actually need wrapping around here.`);
      parts.push('\\begin{verbatim}');
      parts.push(`untouched code line ${i}`);
      parts.push('\\end{verbatim}');
    }
    const source = parts.join('\n') + '\n';

    const t0 = Date.now();
    const result = await wrapRegions(source, 'latex', 'all', cfg, parserManager);
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(15_000);

    expect(result.skipped).toEqual([]);
    const wrapped = applyTextEdits(source, result.edits);
    // Every verbatim line survives untouched.
    for (let i = 0; i < 2_000; i++) {
      expect(wrapped).toContain(`untouched code line ${i}`);
    }

    const second = await wrapRegions(wrapped, 'latex', 'all', cfg, parserManager);
    expect(second.edits).toEqual([]);
  }, 30_000);

  it('handles a 10,000-line single prose paragraph (no blank lines) without crashing or hanging', async () => {
    // Measured ~300ms — recorded in docs/benchmarks.md. One giant
    // 'prose' region, not 10,000 tiny ones — mirrors
    // `./markdown-pathological-input.test.ts`'s own equivalent case.
    const lines: string[] = [];
    for (let i = 0; i < 10_000; i++) {
      lines.push(`word${i}`);
    }
    const source = lines.join('\n') + '\n';

    const t0 = Date.now();
    const result = await wrapRegions(source, 'latex', 'all', cfg, parserManager);
    expect(Date.now() - t0).toBeLessThan(5_000);

    expect(result.edits).toHaveLength(1);
    const wrapped = applyTextEdits(source, result.edits);
    for (const line of wrapped.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(cfg.columnLimit);
    }

    const second = await wrapRegions(wrapped, 'latex', 'all', cfg, parserManager);
    expect(second.edits).toEqual([]);
  }, 10_000);

  it('handles 5,000 \\item entries in one list without crashing or hanging', async () => {
    // Measured ~2.1s in isolation (~0.13-0.4ms/item, falling as the
    // count grows — see the scaling note on the masked-environments case
    // above) — recorded in docs/benchmarks.md. 5,000 *separate* regions,
    // each its own `wrapLatexProse` call (dissolve, reflow, emit), is a
    // meaningfully different cost shape from the single-giant-region
    // 10,000-line case above — confirmed linear, not quadratic, by
    // direct measurement rather than assumed safe just because each
    // individual step looks cheap in isolation. Bound kept wide for the
    // identical full-suite CPU-contention reason the masked-environments
    // case's own doc comment explains, not a tight latency SLA.
    const lines: string[] = ['\\begin{itemize}'];
    for (let i = 0; i < 5_000; i++) {
      lines.push(`  \\item Item number ${i} with enough text to need wrapping onto a continuation line.`);
    }
    lines.push('\\end{itemize}');
    const source = lines.join('\n') + '\n';

    const t0 = Date.now();
    const result = await wrapRegions(source, 'latex', 'all', cfg, parserManager);
    expect(Date.now() - t0).toBeLessThan(15_000);

    expect(result.skipped).toEqual([]);
    const wrapped = applyTextEdits(source, result.edits);
    for (const line of wrapped.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(cfg.columnLimit);
    }

    const second = await wrapRegions(wrapped, 'latex', 'all', cfg, parserManager);
    expect(second.edits).toEqual([]);
  }, 30_000);

  it('handles an unterminated \\begin{verbatim} without crashing or corrupting anything, via the generic ERROR-overlap skip', async () => {
    // Confirmed directly (docs/spikes/tree-sitter-latex-probe7.mjs), not
    // assumed the way `./markdown-pathological-input.test.ts`'s own
    // unterminated-fence case could be: unlike tree-sitter-markdown's
    // graceful "extend the fence to end of file" recovery, this grammar
    // produces a genuine ERROR node for an unterminated \begin{...} (of
    // *any* environment, not just verbatim — the begin/end structure
    // itself is what fails to close, not anything verbatim-specific).
    // So this input is never masked by this adapter's own row-masking at
    // all — it's protected by wrap.ts's generic "region overlaps a parse
    // ERROR" skip instead, the same mechanism protecting every other
    // adapter's own unparseable input. `result.edits` staying empty is
    // the real safety property; `result.skipped` is correctly non-empty
    // here (both the "some code" and the trailing prose text get
    // discovered as ordinary 'prose' regions and then skipped for
    // overlapping the ERROR), which is the opposite of what a
    // masking-based recovery would look like — worth asserting
    // explicitly so a future reader doesn't mistake the empty-`skipped`
    // shape for what "safe" means here.
    const source = '\\begin{verbatim}\nsome code\n\nSome text after that never closes the environment.\n';

    const result = await wrapRegions(source, 'latex', 'all', cfg, parserManager);
    expect(result.edits).toEqual([]);
    expect(result.skipped.length).toBeGreaterThan(0);
    for (const skip of result.skipped) {
      expect(skip.reason).toBe('region overlaps a parse error');
    }
  });
});
