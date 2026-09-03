import { beforeAll, describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../../src/adapter-registry.js';
import { ParserManager } from '../../src/parser/parser-manager.js';
import type { WrapConfig } from '../../src/types/config.js';
import type { LanguageAdapter } from '../../src/types/adapter.js';
import { pythonAdapter } from '../../src/languages/python/adapter.js';
import { javascriptAdapter } from '../../src/languages/javascript/adapter.js';
import { typescriptAdapter } from '../../src/languages/typescript/adapter.js';
import { cppAdapter } from '../../src/languages/cpp/adapter.js';
import { javaAdapter } from '../../src/languages/java/adapter.js';
import { markdownAdapter } from '../../src/languages/markdown/adapter.js';
import { latexAdapter } from '../../src/languages/latex/adapter.js';
import { wrapRegions } from '../../src/wrap.js';

/**
 * Performance benchmarks and large-file guardrails — the engine-side
 * half. `docs/benchmarks.md` documents the actual measured Python numbers
 * these thresholds were originally derived from, and the two real
 * quadratic-cost bugs the benchmarking work that introduced this suite
 * found and fixed (`sliceSpanText`'s and `detectLineEndingNear`'s own doc
 * comments carry the full detail):
 *
 * - `sliceSpanText` re-split the entire file on every call — called at
 *   least once per region — making "wrap every region in the file"
 *   quadratic in file size.
 * - `detectLineEndingNear` (added earlier in this same phase) had the
 *   identical bug from the moment it was introduced.
 *
 * Both fixes live in shared engine code (`sliceSpanText`,
 * `detectLineEndingNear` are both language-agnostic), so a regression in
 * either would in principle show up for any adapter — but this suite only
 * ever exercised Python, even after JS/TS/C++/Java landed. Parameterized
 * across every registered adapter here, following the same pattern
 * `../wrap/idempotency-all-fixtures.test.ts` and this directory's other
 * suites already established, so a quadratic-cost regression specific to
 * one adapter's own discovery/dissolve/emit path (not the shared code
 * above) has a chance of being caught too.
 *
 * These are regression guards, not a micro-benchmark harness: generous
 * upper bounds with real headroom, so ordinary machine variance and
 * future feature work don't make this test flaky, while still catching
 * a *class* of regression (a reintroduced quadratic cost) that would
 * blow through them by an order of magnitude, the way both bugs above
 * did before they were fixed. The bounds below are carried over unchanged
 * from the Python-only version rather than re-tuned per language: they
 * were already generous margins over a measured worst case, not a tight
 * SLA, and every adapter shares the same `wrapRegions` pipeline this
 * suite is actually timing.
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
  /**
   * A synthetic file with an unrealistically *high* density of wrappable
   * regions (every 5th line, alternating comment/string) — real code
   * wraps a much smaller fraction of its lines, so this is deliberately a
   * worse case than any real file of the same line count, giving the
   * time bounds below real margin rather than being tuned to just barely
   * pass.
   */
  readonly generateFile: (lineCount: number) => string;
  readonly warmUpSource: string;
  /**
   * Bound for "wrap a single region near the cursor," below — defaults
   * to 200ms (every language before LaTeX). `discoverRegions`
   * (`../../src/wrap.ts`) runs discovery on the *whole* tree regardless
   * of `targets`, filtering to the requested region only afterward — so
   * "near-instant, independent of file size" was never literally true of
   * *discovery* for any adapter, only of the (typically far cheaper)
   * dissolve/reflow/emit step that follows it once discovery has already
   * narrowed things down. That distinction stayed invisible for every
   * adapter before LaTeX because a single tree-sitter query pass is
   * cheap enough, even at 5,000 lines, that discovery's own cost never
   * dominated the 200ms budget. LaTeX's `discoverLatexProse`
   * (masked line scan, §6.2) is a genuinely more expensive discovery
   * mechanism — a combined whole-tree `descendantsOfType` walk (once
   * sixteen separate single-type walks, until a real ~17× cost found and
   * fixed while investigating this — see `buildTreeIndexes`'s own doc
   * comment in `../../src/languages/latex/discover-prose.ts`) plus a
   * per-line masking/structural/comment/item check for every row of the
   * file, none of it query-driven — so this is the first adapter where
   * discovery's own cost (now smaller, but still real) is what the
   * near-cursor number actually measures, alongside parse time itself
   * (shared by every adapter, not LaTeX-specific). Confirmed *linear* in
   * file size, not quadratic, by direct measurement across several sizes
   * (a one-off scaling check, not committed as its own test) before
   * setting this override rather than guessing a bound; `docs/benchmarks.md`
   * records the real numbers.
   */
  readonly nearCursorBoundMs?: number;
}

function pythonBody(lineCount: number): string {
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

function jsBody(lineCount: number): string {
  const lines: string[] = [];
  for (let i = 0; i < lineCount; i++) {
    if (i % 10 === 0) {
      lines.push(
        `// This is a fairly long comment line number ${i} that will likely need wrapping around`,
      );
    } else if (i % 10 === 5) {
      lines.push(
        `const x_${i} = "a string value number ${i} that is reasonably long and might need wrapping too";`,
      );
    } else {
      lines.push(`const y_${i} = ${i};`);
    }
  }
  return lines.join('\n') + '\n';
}

/**
 * Markdown's own worst case is the *opposite* of every code language
 * above's: a real Markdown document is close to 100% wrappable-region
 * density already (ordinary prose, not "mostly non-wrappable code with
 * the occasional comment"), so — unlike `pythonBody`/`jsBody`/`cLikeBody`,
 * which inflate density well past anything realistic to give the time
 * bounds real margin — this doesn't need to inflate anything to already
 * be the worst case (`docs/planning/markdown-latex-plan.md` §8.4: "every
 * line a region line — worse than any code file's region density"). Many
 * separate two-line paragraphs (not one giant one) so the "wrap a single
 * region near the cursor" test below still has many other regions in the
 * file to *not* wrap, the same property it checks for every other
 * language.
 */
function markdownBody(lineCount: number): string {
  const lines: string[] = [];
  let i = 0;
  while (lines.length < lineCount) {
    lines.push(
      `This is paragraph number ${i}, a fairly long line of ordinary prose that will likely need wrapping.`,
    );
    lines.push(`A second line continuing that same paragraph, also long enough to matter.`);
    lines.push('');
    i++;
  }
  return lines.slice(0, lineCount).join('\n') + '\n';
}

/**
 * LaTeX's own worst case, same reasoning as `markdownBody` just above:
 * ordinary prose is already close to 100% wrappable-region density, so
 * this doesn't need to inflate anything either — plain paragraphs, no
 * `%` comments, `\section` headers, or masked environments needed to be
 * a real stress case, since `discoverLatexProse`'s masked line scan
 * still does its own per-line structural/comment/item checks on every
 * one of these lines even though none of them actually trigger.
 */
function latexBody(lineCount: number): string {
  const lines: string[] = [];
  let i = 0;
  while (lines.length < lineCount) {
    lines.push(
      `This is paragraph number ${i}, a fairly long line of ordinary prose that will likely need wrapping.`,
    );
    lines.push(`A second line continuing that same paragraph, also long enough to matter.`);
    lines.push('');
    i++;
  }
  return lines.slice(0, lineCount).join('\n') + '\n';
}

/** C++/Java both need every statement inside one enclosing function/method — neither allows a bare top-level statement. */
function cLikeBody(lineCount: number, indent: string): string {
  const lines: string[] = [];
  for (let i = 0; i < lineCount; i++) {
    if (i % 10 === 0) {
      lines.push(
        `${indent}// This is a fairly long comment line number ${i} that will likely need wrapping around`,
      );
    } else if (i % 10 === 5) {
      lines.push(
        `${indent}x_${i} = "a string value number ${i} that is reasonably long and might need wrapping too";`,
      );
    } else {
      lines.push(`${indent}y_${i} = ${i};`);
    }
  }
  return lines.join('\n');
}

const LANGUAGE_SETS: readonly LanguageSet[] = [
  {
    languageId: 'python',
    adapter: pythonAdapter,
    commentMarker: '#',
    generateFile: pythonBody,
    warmUpSource: '# warm up\n',
  },
  {
    languageId: 'javascript',
    adapter: javascriptAdapter,
    commentMarker: '//',
    generateFile: jsBody,
    warmUpSource: '// warm up\n',
  },
  {
    languageId: 'typescript',
    adapter: typescriptAdapter,
    commentMarker: '//',
    generateFile: jsBody,
    warmUpSource: '// warm up\n',
  },
  {
    languageId: 'cpp',
    adapter: cppAdapter,
    commentMarker: '//',
    generateFile: (lineCount) => `void f() {\n${cLikeBody(lineCount, '  ')}\n}\n`,
    warmUpSource: '// warm up\n',
  },
  {
    languageId: 'java',
    adapter: javaAdapter,
    commentMarker: '//',
    generateFile: (lineCount) =>
      `class C {\n  void f() {\n${cLikeBody(lineCount, '    ')}\n  }\n}\n`,
    warmUpSource: '// warm up\n',
  },
  {
    languageId: 'markdown',
    adapter: markdownAdapter,
    // Markdown has no comment marker at all — `commentMarker` is only
    // ever used below to locate a real region's start via
    // `source.indexOf(commentMarker)`; an empty string's `indexOf` is
    // always `0`, which is exactly where `markdownBody`'s first
    // paragraph starts (no preamble before it, unlike C++/Java's
    // enclosing function/class header).
    commentMarker: '',
    generateFile: markdownBody,
    warmUpSource: 'warm up\n',
  },
  {
    languageId: 'latex',
    adapter: latexAdapter,
    // Same reasoning as Markdown's own empty marker above: `latexBody`
    // is pure prose starting at column 0, no `%` comment anywhere in it.
    commentMarker: '',
    generateFile: latexBody,
    warmUpSource: 'warm up\n',
    // Measured ~220-270ms at 5,000 lines in isolation on this machine
    // (down from ~350-390ms before discoverLatexProse's own
    // sixteen-separate-descendantsOfType-calls fix — see that function's
    // doc comment) — see the `nearCursorBoundMs` field's own doc comment
    // above for why this is the one adapter where growing with file size
    // is expected rather than a regression at all. 2s keeps real margin
    // above the isolated measurement (this suite's own other LaTeX
    // bounds needed similarly wide margin to survive running alongside
    // every other CPU-bound hardening/performance test at once — real
    // contention, confirmed by rerunning in isolation and seeing the
    // smaller number again, not a regression) while still well below
    // what a quadratic-cost bug (rather than this linear, understood
    // cost) would produce.
    nearCursorBoundMs: 2_000,
  },
];

let parserManager: ParserManager;

beforeAll(async () => {
  const registry = new AdapterRegistry();
  for (const { adapter } of LANGUAGE_SETS) {
    registry.register(adapter);
  }
  parserManager = await ParserManager.create({ wasmDir: '.', registry });
});

describe.each(LANGUAGE_SETS)(
  'large-file performance ($languageId)',
  ({ languageId, commentMarker, generateFile, warmUpSource, nearCursorBoundMs = 200 }) => {
    it('wraps a 1,000-line file in well under a second', async () => {
      const source = generateFile(1_000);
      const t0 = Date.now();
      await wrapRegions(source, languageId, 'all', cfg, parserManager);
      expect(Date.now() - t0).toBeLessThan(1_000);
    });

    it('wraps a 10,000-line file in a few seconds', async () => {
      const source = generateFile(10_000);
      const t0 = Date.now();
      await wrapRegions(source, languageId, 'all', cfg, parserManager);
      expect(Date.now() - t0).toBeLessThan(5_000);
    }, 20_000);

    it('wraps a 50,000-line file without the quadratic blowup this suite guards against', async () => {
      // Measured ~7s after the fix (docs/benchmarks.md, Python) vs. ~60s
      // before — the bound here is set well above the fixed number and
      // well below the regressed one, so this fails loudly if either
      // bug's class of cost (or a similar one) comes back.
      const source = generateFile(50_000);
      const t0 = Date.now();
      await wrapRegions(source, languageId, 'all', cfg, parserManager);
      expect(Date.now() - t0).toBeLessThan(20_000);
    }, 60_000);

    it('wraps a single region near the cursor in a large file near-instantly, independent of file size', async () => {
      // The stated budget: "wrap-at-cursor should feel instant (< 50 ms
      // after warm grammar load)." A generous 200ms default bound (this
      // machine's own measured number was ~30ms for Python) rather than
      // literally 50 — CI hardware varies, and the property under test is
      // "independent of file size," not a tight latency SLA. LaTeX
      // overrides this default (`nearCursorBoundMs` on its own
      // `LANGUAGE_SETS` entry, and that field's own doc comment) since
      // its discovery mechanism is genuinely, and measurably, more
      // expensive per line than every other adapter's query-based one.
      const source = generateFile(5_000);
      await wrapRegions(warmUpSource, languageId, 'all', cfg, parserManager); // warm the grammar first

      // The first comment's own position, not a hardcoded byte 0: C++/Java
      // wrap the generated body in an enclosing function/class header, so
      // the file's very first byte isn't inside a wrappable region for
      // them the way it is for Python/JS/TS.
      const commentStart = source.indexOf(commentMarker);
      const target = [
        {
          startByte: commentStart,
          endByte: commentStart + 1,
          startRow: 0,
          startColumn: 0,
          endRow: 0,
          endColumn: 1,
        },
      ];
      const t0 = Date.now();
      await wrapRegions(source, languageId, target, cfg, parserManager);
      expect(Date.now() - t0).toBeLessThan(nearCursorBoundMs);
    });
  },
);
