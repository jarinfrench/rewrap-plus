import { beforeAll, describe, expect, it } from 'vitest';
import { createTestParserManager } from '../helpers/create-test-parser-manager.js';
import { applyTextEdits } from '../../src/apply-edits.js';
import { ParserManager } from '../../src/parser/parser-manager.js';
import type { WrapConfig } from '../../src/types/config.js';
import { cppAdapter } from '../../src/languages/cpp/adapter.js';
import { wrapRegions } from '../../src/wrap.js';

import plainIn from '../fixtures/cpp/block-comments/001-plain-narrative.in.cpp?raw';
import plainOut from '../fixtures/cpp/block-comments/001-plain-narrative.out.cpp?raw';

/**
 * Gold fixtures for a plain single-star `/* ... * /` `'blockComment'`
 * region (no Doxygen marker) -- `descriptor.comments.plainBlock`'s
 * distinct open delimiter, dissolved/emitted through
 * `dissolveBlockComments`/`emitBlockComments`
 * (`../../src/comments/dissolve-block-comments.ts`,
 * `../../src/comments/emit-block-comments.ts`), end to end via
 * `wrapRegions`. Mirrors this package's established fixture-driven
 * convention (`./cpp-doc-comment-wrap-fixtures.test.ts`).
 */
const COLUMN_LIMIT = 60;

interface Fixture {
  readonly name: string;
  readonly input: string;
  readonly expected: string;
}

const fixtures: readonly Fixture[] = [{ name: '001-plain-narrative', input: plainIn, expected: plainOut }];

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

let parserManager: ParserManager;

beforeAll(async () => {
  parserManager = await createTestParserManager(cppAdapter);
});

describe('C++ blockComment (plain /* */) wrapping -- end-to-end gold fixtures', () => {
  it.each(fixtures.map((f) => [f.name, f] as const))('%s', async (_name, fixture) => {
    const result = await wrapRegions(fixture.input, 'cpp', 'all', config(), parserManager);
    const actual = applyTextEdits(fixture.input, result.edits);
    expect(actual).toBe(fixture.expected);
  });

  it('uses a single-star open delimiter, never the Doxygen /**', () => {
    expect(plainOut.startsWith('/*\n')).toBe(true);
    expect(plainOut.startsWith('/**')).toBe(false);
  });

  it('produces no line over the column limit', async () => {
    const result = await wrapRegions(plainIn, 'cpp', 'all', config(), parserManager);
    const actual = applyTextEdits(plainIn, result.edits);
    for (const line of actual.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(COLUMN_LIMIT);
    }
  });

  it('is idempotent: re-wrapping the gold output produces no further edits', async () => {
    const result = await wrapRegions(plainOut, 'cpp', 'all', config(), parserManager);
    expect(result.edits).toEqual([]);
  });
});
