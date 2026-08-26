import { beforeAll, describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../../src/adapter-registry.js';
import { applyTextEdits } from '../../src/apply-edits.js';
import { ParserManager } from '../../src/parser/parser-manager.js';
import type { WrapConfig } from '../../src/types/config.js';
import { typescriptAdapter } from '../../src/languages/typescript/adapter.js';
import { wrapRegions } from '../../src/wrap.js';

import longProseIn from '../fixtures/typescript/strings/001-long-prose-message.in.ts?raw';
import longProseOut from '../fixtures/typescript/strings/001-long-prose-message.out.ts?raw';
import needsNoParensIn from '../fixtures/typescript/strings/002-needs-parens-not-required.in.ts?raw';
import needsNoParensOut from '../fixtures/typescript/strings/002-needs-parens-not-required.out.ts?raw';
import negSqlIn from '../fixtures/typescript/strings/neg-001-sql-query.in.ts?raw';
import negSqlOut from '../fixtures/typescript/strings/neg-001-sql-query.out.ts?raw';
import negUrlIn from '../fixtures/typescript/strings/neg-002-url.in.ts?raw';
import negUrlOut from '../fixtures/typescript/strings/neg-002-url.out.ts?raw';

/**
 * TypeScript's own string-wrapping gold fixtures — mirrors
 * `./javascript-string-wrap-fixtures.test.ts`, proving the identical
 * shared `strings/` pipeline behaves the same way through the
 * `tree-sitter-typescript` grammar (type annotations included) as it
 * does through `tree-sitter-javascript`.
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
    name: '002-needs-parens-not-required',
    input: needsNoParensIn,
    expected: needsNoParensOut,
    positive: true,
  },
  { name: 'neg-001-sql-query', input: negSqlIn, expected: negSqlOut, positive: false },
  { name: 'neg-002-url', input: negUrlIn, expected: negUrlOut, positive: false },
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
  registry.register(typescriptAdapter);
  parserManager = await ParserManager.create({ wasmDir: engineRoot, registry });
});

describe('TypeScript string-literal wrapping — end-to-end gold fixtures', () => {
  it.each(fixtures.map((f) => [f.name, f] as const))('%s', async (_name, fixture) => {
    const result = await wrapRegions(fixture.input, 'typescript', 'all', config(), parserManager);
    const actual = applyTextEdits(fixture.input, result.edits);
    expect(actual).toBe(fixture.expected);
  });

  it('every negative fixture is byte-identical between .in and .out', () => {
    for (const fixture of fixtures.filter((f) => !f.positive)) {
      expect(fixture.input).toBe(fixture.expected);
    }
  });

  it('is idempotent: re-wrapping the gold output produces no further edits', async () => {
    for (const fixture of fixtures) {
      const result = await wrapRegions(fixture.expected, 'typescript', 'all', config(), parserManager);
      expect(result.edits).toEqual([]);
    }
  });

  it('never requires inserted parens even inside a return statement', async () => {
    const result = await wrapRegions(needsNoParensIn, 'typescript', 'all', config(), parserManager);
    for (const edit of result.edits) {
      expect(edit.newText).not.toMatch(/^\(/);
    }
  });
});
