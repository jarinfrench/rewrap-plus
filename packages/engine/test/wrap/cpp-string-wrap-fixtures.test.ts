import { beforeAll, describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../../src/adapter-registry.js';
import { applyTextEdits } from '../../src/apply-edits.js';
import { ParserManager } from '../../src/parser/parser-manager.js';
import type { WrapConfig } from '../../src/types/config.js';
import { cppAdapter } from '../../src/languages/cpp/adapter.js';
import { wrapRegions } from '../../src/wrap.js';

import longProseIn from '../fixtures/cpp/strings/001-long-prose-message.in.cpp?raw';
import longProseOut from '../fixtures/cpp/strings/001-long-prose-message.out.cpp?raw';
import rebalancedIn from '../fixtures/cpp/strings/002-existing-concat-rebalanced.in.cpp?raw';
import rebalancedOut from '../fixtures/cpp/strings/002-existing-concat-rebalanced.out.cpp?raw';
import alreadyWrappedIn from '../fixtures/cpp/strings/003-already-correctly-wrapped-byte-identical.in.cpp?raw';
import alreadyWrappedOut from '../fixtures/cpp/strings/003-already-correctly-wrapped-byte-identical.out.cpp?raw';
import negSqlIn from '../fixtures/cpp/strings/neg-001-sql-query.in.cpp?raw';
import negSqlOut from '../fixtures/cpp/strings/neg-001-sql-query.out.cpp?raw';
import negRawIn from '../fixtures/cpp/strings/neg-002-raw-string.in.cpp?raw';
import negRawOut from '../fixtures/cpp/strings/neg-002-raw-string.out.cpp?raw';

/**
 * Phase 12c's own string-wrapping gold fixtures for the C++ adapter —
 * mirrors `./javascript-string-wrap-fixtures.test.ts`'s structure and
 * rationale, proving the *shared* `strings/dissolve-string.ts`/
 * `strings/emit-string.ts` behaves correctly for C++'s `'implicit'`-only,
 * no-grouping-required, no-operator-style concatenation — a third real
 * shape (Python has `'implicit'`-with-grouping and `'operator'`; JS/TS
 * have `'operator'`-only; C++ has `'implicit'`-only) this shared code
 * hadn't been exercised by before this phase.
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
  { name: 'neg-002-raw-string', input: negRawIn, expected: negRawOut, positive: false },
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
  registry.register(cppAdapter);
  parserManager = await ParserManager.create({ wasmDir: engineRoot, registry });
});

describe('C++ string-literal wrapping — end-to-end gold fixtures', () => {
  it.each(fixtures.map((f) => [f.name, f] as const))('%s', async (_name, fixture) => {
    const result = await wrapRegions(fixture.input, 'cpp', 'all', config(), parserManager);
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
      const result = await wrapRegions(fixture.input, 'cpp', 'all', config(), parserManager);
      const actual = applyTextEdits(fixture.input, result.edits);
      for (const line of actual.split('\n')) {
        expect(line.length).toBeLessThanOrEqual(COLUMN_LIMIT);
      }
    }
  });

  it('is idempotent: re-wrapping the gold output produces no further edits', async () => {
    for (const fixture of fixtures) {
      const result = await wrapRegions(fixture.expected, 'cpp', 'all', config(), parserManager);
      expect(result.edits).toEqual([]);
    }
  });

  it('never inserts a concatenation operator — bare adjacency is C++\'s only real join syntax', async () => {
    for (const fixture of fixtures.filter((f) => f.positive)) {
      const result = await wrapRegions(fixture.input, 'cpp', 'all', config(), parserManager);
      for (const edit of result.edits) {
        expect(edit.newText).not.toMatch(/"\s*\+\s*"/);
      }
    }
  });

  it('never requires inserted parens — bare adjacency needs no grouping', async () => {
    for (const fixture of fixtures.filter((f) => f.positive)) {
      const result = await wrapRegions(fixture.input, 'cpp', 'all', config(), parserManager);
      for (const edit of result.edits) {
        expect(edit.newText).not.toMatch(/^\(/);
      }
    }
  });
});
