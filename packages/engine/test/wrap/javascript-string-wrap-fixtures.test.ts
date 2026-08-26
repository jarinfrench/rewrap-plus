import { beforeAll, describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../../src/adapter-registry.js';
import { applyTextEdits } from '../../src/apply-edits.js';
import { ParserManager } from '../../src/parser/parser-manager.js';
import type { WrapConfig } from '../../src/types/config.js';
import { javascriptAdapter } from '../../src/languages/javascript/adapter.js';
import { wrapRegions } from '../../src/wrap.js';

import longProseIn from '../fixtures/javascript/strings/001-long-prose-message.in.js?raw';
import longProseOut from '../fixtures/javascript/strings/001-long-prose-message.out.js?raw';
import rebalancedIn from '../fixtures/javascript/strings/002-existing-concat-rebalanced.in.js?raw';
import rebalancedOut from '../fixtures/javascript/strings/002-existing-concat-rebalanced.out.js?raw';
import alreadyWrappedIn from '../fixtures/javascript/strings/003-already-correctly-wrapped-byte-identical.in.js?raw';
import alreadyWrappedOut from '../fixtures/javascript/strings/003-already-correctly-wrapped-byte-identical.out.js?raw';
import negSqlIn from '../fixtures/javascript/strings/neg-001-sql-query.in.js?raw';
import negSqlOut from '../fixtures/javascript/strings/neg-001-sql-query.out.js?raw';
import negUrlIn from '../fixtures/javascript/strings/neg-002-url.in.js?raw';
import negUrlOut from '../fixtures/javascript/strings/neg-002-url.out.js?raw';
import negPathIn from '../fixtures/javascript/strings/neg-003-path-literal.in.js?raw';
import negPathOut from '../fixtures/javascript/strings/neg-003-path-literal.out.js?raw';

/**
 * Phase 12b's own string-wrapping gold fixtures for the now-full
 * JavaScript adapter — mirrors
 * `./python-string-wrap-fixtures.test.ts`'s structure and rationale,
 * proving the *shared* `strings/dissolve-string.ts`/`strings/emit-string.ts`
 * (promoted out of `languages/python/` this same phase) behaves
 * identically for JS/TS's `'operator'`-only, no-grouping-required
 * concatenation as it does for Python's `'implicit'`/`'operator'` pair.
 */
const COLUMN_LIMIT = 60;

interface Fixture {
  readonly name: string;
  readonly input: string;
  readonly expected: string;
  readonly positive: boolean;
}

const fixtures: readonly Fixture[] = [
  { name: '001-long-prose-message', input: longProseIn, expected: longProseOut, positive: true },
  {
    name: '002-existing-concat-rebalanced',
    input: rebalancedIn,
    expected: rebalancedOut,
    positive: true,
  },
  {
    name: '003-already-correctly-wrapped-byte-identical',
    input: alreadyWrappedIn,
    expected: alreadyWrappedOut,
    positive: true,
  },
  { name: 'neg-001-sql-query', input: negSqlIn, expected: negSqlOut, positive: false },
  { name: 'neg-002-url', input: negUrlIn, expected: negUrlOut, positive: false },
  { name: 'neg-003-path-literal', input: negPathIn, expected: negPathOut, positive: false },
];

function config(overrides: Partial<WrapConfig> = {}): WrapConfig {
  return {
    columnLimit: COLUMN_LIMIT,
    tabSize: 4,
    wrapComments: true,
    wrapStrings: true,
    stringPolicy: 'prose',
    docDialect: 'auto',
    preserveIndentedBlocks: false,
    balancedWrapping: false,
    ...overrides,
  };
}

const engineRoot = '.';

let parserManager: ParserManager;

beforeAll(async () => {
  const registry = new AdapterRegistry();
  registry.register(javascriptAdapter);
  parserManager = await ParserManager.create({ wasmDir: engineRoot, registry });
});

describe('JavaScript string-literal wrapping — end-to-end gold fixtures', () => {
  it.each(fixtures.map((f) => [f.name, f] as const))('%s', async (_name, fixture) => {
    const result = await wrapRegions(fixture.input, 'javascript', 'all', config(), parserManager);
    const actual = applyTextEdits(fixture.input, result.edits);
    expect(actual).toBe(fixture.expected);
  });

  it('every negative fixture is byte-identical between .in and .out', () => {
    for (const fixture of fixtures.filter((f) => !f.positive)) {
      expect(fixture.input).toBe(fixture.expected);
    }
  });

  it('every positive fixture actually changes the source, except the already-wrapped one', () => {
    for (const fixture of fixtures.filter((f) => f.positive)) {
      if (fixture.name === '003-already-correctly-wrapped-byte-identical') {
        expect(fixture.expected).toBe(fixture.input);
        continue;
      }
      expect(fixture.expected).not.toBe(fixture.input);
    }
  });

  it('produces no line over the column limit for any positive fixture', async () => {
    for (const fixture of fixtures.filter((f) => f.positive)) {
      const result = await wrapRegions(fixture.input, 'javascript', 'all', config(), parserManager);
      const actual = applyTextEdits(fixture.input, result.edits);
      for (const line of actual.split('\n')) {
        expect(line.length).toBeLessThanOrEqual(COLUMN_LIMIT);
      }
    }
  });

  it('is idempotent: re-wrapping the gold output produces no further edits', async () => {
    for (const fixture of fixtures) {
      const result = await wrapRegions(fixture.expected, 'javascript', 'all', config(), parserManager);
      expect(result.edits).toEqual([]);
    }
  });

  it('never requires inserted parens — JS/TS operator concatenation needs no grouping', async () => {
    for (const fixture of fixtures.filter((f) => f.positive)) {
      const result = await wrapRegions(fixture.input, 'javascript', 'all', config(), parserManager);
      for (const edit of result.edits) {
        expect(edit.newText).not.toMatch(/^\(/);
      }
    }
  });
});
