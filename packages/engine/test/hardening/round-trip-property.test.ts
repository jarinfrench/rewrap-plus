import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../../src/adapter-registry.js';
import { applyTextEdits } from '../../src/apply-edits.js';
import { ParserManager } from '../../src/parser/parser-manager.js';
import { parseWithErrors } from '../../src/parser/parse-result.js';
import type { WrapConfig } from '../../src/types/config.js';
import { pythonAdapter } from '../../src/languages/python/adapter.js';
import { wrapRegions } from '../../src/wrap.js';
import { extractConcatenatedStringValue } from '../support/decode-python-string.js';

/**
 * Phase 10, "add round-trip property tests with generated input":
 * fast-check generators for comments/docstrings/strings, asserting the
 * plan's own four named properties — idempotent, no line over limit
 * except a lone atom, output still parses, string values unchanged —
 * against generated rather than hand-written source.
 *
 * Deliberately word-bank-based rather than raw fuzzed Unicode: a
 * generator that could produce quotes, backslashes, or newlines *inside*
 * the generated content would mostly be exercising dissolve/escape edge
 * cases — real, but already covered by Phase 9's own hand-written,
 * eval-equivalence-checked gold fixtures (`../wrap/python-string-wrap-
 * fixtures.test.ts`), which can name and check an *exact* expected
 * decoded value in a way a property test can't as usefully. What this
 * suite adds on top is broad, structural randomization the gold fixtures
 * don't: word count, word length, column limit, and nesting depth (for
 * comments/docstrings) all vary per run, exercising the reflow/emit
 * pipeline's general shape rather than any one hand-picked case.
 */
const WORD_BANK = [
  'a',
  'i',
  'to',
  'of',
  'the',
  'word',
  'words',
  'prose',
  'sentence',
  'wraps',
  'wrapping',
  'around',
  'nicely',
  'here',
  'there',
  'testing',
  'engine',
  'value',
  'reflow',
  'column',
  'limit',
  'paragraph',
  'documentation',
  'implementation',
  'extraordinarily',
  'supercalifragilisticexpialidocious',
];

const wordArb = fc.constantFrom(...WORD_BANK);
const sentenceArb = fc
  .array(wordArb, { minLength: 1, maxLength: 40 })
  .map((words) => words.join(' '));
const columnLimitArb = fc.integer({ min: 20, max: 100 });
const depthArb = fc.integer({ min: 0, max: 3 });

const NUM_RUNS = 40;

function config(overrides: Partial<WrapConfig> = {}): WrapConfig {
  return {
    columnLimit: 60,
    tabSize: 4,
    wrapComments: true,
    wrapStrings: true,
    stringPolicy: 'all',
    docDialect: 'plain',
    preserveIndentedBlocks: false,
    balancedWrapping: false,
    ...overrides,
  };
}

/** Wrap `line` in `depth` levels of nested `def f():` — 4 spaces per level. */
function nestDef(depth: number, line: string): string {
  let body = line;
  for (let i = 0; i < depth; i++) {
    const indent = ' '.repeat((depth - i - 1) * 4 + 4);
    const reindented = body
      .split('\n')
      .map((l) => (l.length > 0 ? indent + l : l))
      .join('\n');
    body = `${' '.repeat((depth - i - 1) * 4)}def f${i}():\n${reindented}`;
  }
  return body + '\n';
}

/**
 * The overflow rule allows a single unbreakable atom (one word here,
 * since the word bank never contains spaces) to exceed the column limit
 * — mirrors the same allowance every gold-fixture suite's own "no line
 * over the limit" check makes (e.g. `../wrap/python-comment-wrap-
 * fixtures.test.ts`).
 *
 * Scoped to `edits[*].newText` — exactly the text `wrapRegions` produced
 * — never the whole reassembled file: an untouched code line (`def
 * f0():`, `x = (`) is neither reflowed content nor this property's
 * concern, the same reasoning `run-adapter-conformance.ts`'s own
 * over-limit check documents.
 */
function assertNoLineOverLimitExceptLoneAtom(
  edits: readonly { readonly newText: string }[],
  columnLimit: number,
): void {
  for (const edit of edits) {
    for (const line of edit.newText.split(/\r?\n/)) {
      if (line.length <= columnLimit) {
        continue;
      }
      const withoutDecoration = line
        .trim()
        .replace(/^\(/, '')
        .replace(/\)$/, '')
        .replace(/^"""|"""$/g, '')
        .replace(/^#\s?/, '')
        .replace(/^"|"$/g, '')
        // A single *trailing* space is the deliberate "preserve the
        // trailing space at split points" glue Phase 9's string-emit
        // fixtures cover (`"foo " "bar"`, not `"foo" "bar"`) — not a
        // second atom sharing this line, so it doesn't disqualify an
        // otherwise-lone-atom line the way an *interior* space would.
        .replace(/ +$/, '');
      expect(withoutDecoration).not.toMatch(/ /);
    }
  }
}

let parserManager: ParserManager;

beforeAll(async () => {
  const registry = new AdapterRegistry();
  registry.register(pythonAdapter);
  parserManager = await ParserManager.create({ wasmDir: '.', registry });
});

describe('round-trip properties over generated input', () => {
  it('line comments: idempotent, within-limit, and always re-parse cleanly', async () => {
    await fc.assert(
      fc.asyncProperty(sentenceArb, columnLimitArb, depthArb, async (sentence, columnLimit, depth) => {
        const source = nestDef(depth, `${' '.repeat(depth * 4)}# ${sentence}`);
        const cfg = config({ columnLimit });

        const first = await wrapRegions(source, 'python', 'all', cfg, parserManager);
        const wrapped = applyTextEdits(source, first.edits);

        const second = await wrapRegions(wrapped, 'python', 'all', cfg, parserManager);
        expect(second.edits).toEqual([]);

        assertNoLineOverLimitExceptLoneAtom(first.edits, columnLimit);

        const parser = await parserManager.parserFor('python');
        expect(parseWithErrors(parser, wrapped).hasErrors).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('docstrings: idempotent, within-limit, and always re-parse cleanly', async () => {
    await fc.assert(
      fc.asyncProperty(sentenceArb, columnLimitArb, depthArb, async (sentence, columnLimit, depth) => {
        const source = nestDef(depth + 1, `${' '.repeat((depth + 1) * 4)}"""${sentence}"""`);
        const cfg = config({ columnLimit });

        const first = await wrapRegions(source, 'python', 'all', cfg, parserManager);
        const wrapped = applyTextEdits(source, first.edits);

        const second = await wrapRegions(wrapped, 'python', 'all', cfg, parserManager);
        expect(second.edits).toEqual([]);

        assertNoLineOverLimitExceptLoneAtom(first.edits, columnLimit);

        const parser = await parserManager.parserFor('python');
        expect(parseWithErrors(parser, wrapped).hasErrors).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('string literals: idempotent, within-limit, re-parse cleanly, and the string value never changes', async () => {
    await fc.assert(
      fc.asyncProperty(sentenceArb, columnLimitArb, async (sentence, columnLimit) => {
        const source = `x = "${sentence}"\n`;
        const cfg = config({ columnLimit });

        const first = await wrapRegions(source, 'python', 'all', cfg, parserManager);
        const wrapped = applyTextEdits(source, first.edits);

        const second = await wrapRegions(wrapped, 'python', 'all', cfg, parserManager);
        expect(second.edits).toEqual([]);

        assertNoLineOverLimitExceptLoneAtom(first.edits, columnLimit);

        const parser = await parserManager.parserFor('python');
        expect(parseWithErrors(parser, wrapped).hasErrors).toBe(false);

        expect(extractConcatenatedStringValue(wrapped)).toBe(extractConcatenatedStringValue(source));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
