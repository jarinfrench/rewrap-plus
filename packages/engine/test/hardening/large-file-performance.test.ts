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
  ({ languageId, commentMarker, generateFile, warmUpSource }) => {
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
      // after warm grammar load)." A generous 200ms bound (this
      // machine's own measured number was ~30ms for Python) rather than
      // literally 50 — CI hardware varies, and the property under test is
      // "independent of file size," not a tight latency SLA.
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
      expect(Date.now() - t0).toBeLessThan(200);
    });
  },
);
