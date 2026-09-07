import { beforeAll, describe, expect, it } from 'vitest';
import { createTestParserManager } from '../helpers/create-test-parser-manager.js';
import { applyTextEdits } from '../../src/apply-edits.js';
import { ParserManager } from '../../src/parser/parser-manager.js';
import type { WrapConfig } from '../../src/types/config.js';
import { markdownAdapter } from '../../src/languages/markdown/adapter.js';
import { wrapRegions } from '../../src/wrap.js';

/**
 * Markdown's own named worst cases -- genuinely different pathologies
 * from `./pathological-input.test.ts`'s comment/string-language ones
 * (a long concatenation chain, a huge string
 * literal, mixed tab/space indentation -- none of which Markdown has a
 * concept of), so kept as their own suite rather than shoehorned into
 * that file's `LANGUAGE_SETS` parameterization.
 *
 * All three were measured, not merely assumed safe: each ran in well
 * under a second, none produced a parse error or a skipped region, and
 * `docs/benchmarks.md` records the actual numbers this suite's own
 * comments quote.
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
  parserManager = await createTestParserManager(markdownAdapter);
});

describe('Markdown pathological input hardening', () => {
  it('handles 200-deep nested block quotes without crashing or hanging, wrapping with the full marker chain', async () => {
    // Measured ~28ms -- recorded in docs/benchmarks.md.
    const marker = '> '.repeat(200);
    const source =
      marker +
      'deeply nested text that is long enough to actually need wrapping around here for sure\n';

    const t0 = Date.now();
    const result = await wrapRegions(source, 'markdown', 'all', cfg, parserManager);
    expect(Date.now() - t0).toBeLessThan(2_000);

    expect(result.edits).toHaveLength(1);
    const wrapped = applyTextEdits(source, result.edits);
    // Every continuation line still carries all 200 ">" markers -- the
    // canonical-prefix derivation (`../../src/languages/markdown/continuation-prefix.ts`)
    // doesn't lose any of them at this depth.
    const continuationLines = wrapped.split('\n').slice(1);
    for (const line of continuationLines.filter((l) => l.length > 0)) {
      expect((line.match(/>/g) ?? []).length).toBe(200);
    }

    // Idempotent, the same headline property every fixture suite checks.
    const second = await wrapRegions(wrapped, 'markdown', 'all', cfg, parserManager);
    expect(second.edits).toEqual([]);
  }, 10_000);

  it('handles a 10,000-line single paragraph (no blank lines at all) without crashing or hanging', async () => {
    // Measured ~120ms -- recorded in docs/benchmarks.md. One giant
    // 'prose' region, not 10,000 tiny ones -- the more extreme of the two
    // shapes Sec. 8.4 names (the other, "a 50,000-line file that is entirely
    // paragraphs," is `../hardening/large-file-performance.test.ts`'s own
    // `markdownBody`, many *separate* paragraphs).
    const lines: string[] = [];
    for (let i = 0; i < 10_000; i++) {
      lines.push(`word${i}`);
    }
    const source = lines.join('\n') + '\n';

    const t0 = Date.now();
    const result = await wrapRegions(source, 'markdown', 'all', cfg, parserManager);
    expect(Date.now() - t0).toBeLessThan(5_000);

    expect(result.edits).toHaveLength(1); // one giant paragraph, one region, one edit
    const wrapped = applyTextEdits(source, result.edits);
    for (const line of wrapped.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(cfg.columnLimit);
    }

    const second = await wrapRegions(wrapped, 'markdown', 'all', cfg, parserManager);
    expect(second.edits).toEqual([]);
  }, 10_000);

  it('handles an unterminated fenced code block without crashing, treating everything after it as fence content', async () => {
    // Confirmed directly (not assumed): the grammar recovers with zero
    // parse errors, extending the fenced_code_block to end of file rather
    // than producing an ERROR node -- so this is really a Sec. 5.6 "never a
    // region" check under an edge-case input, not error-recovery
    // behavior this adapter has to handle specially.
    const source = '```python\ndef f():\n    pass\n\nSome text after that never closes the fence.\n';

    const result = await wrapRegions(source, 'markdown', 'all', cfg, parserManager);
    expect(result.edits).toEqual([]);
    expect(result.skipped).toEqual([]);
  });
});
