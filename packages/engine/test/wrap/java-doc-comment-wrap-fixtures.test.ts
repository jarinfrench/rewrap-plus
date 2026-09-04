import { beforeAll, describe, expect, it } from 'vitest';
import { createTestParserManager } from '../helpers/create-test-parser-manager.js';
import { applyTextEdits } from '../../src/apply-edits.js';
import { ParserManager } from '../../src/parser/parser-manager.js';
import type { WrapConfig } from '../../src/types/config.js';
import { javaAdapter } from '../../src/languages/java/adapter.js';
import { wrapRegions } from '../../src/wrap.js';

import javadocIn from '../fixtures/java/doc-comments/001-javadoc-param-return.in.java?raw';
import javadocOut from '../fixtures/java/doc-comments/001-javadoc-param-return.out.java?raw';
import plainIn from '../fixtures/java/doc-comments/002-plain-narrative.in.java?raw';
import plainOut from '../fixtures/java/doc-comments/002-plain-narrative.out.java?raw';

/**
 * Gold fixtures for `'docComment'` regions — the Javadoc dialect
 * (`../../src/docs/javadoc.ts`) applied through `wrapDocComment`
 * (`../../src/comments/wrap-doc-comment.ts`), end to end via
 * `wrapRegions`. Mirrors this package's established fixture-driven
 * convention (`./cpp-doc-comment-wrap-fixtures.test.ts`).
 */
const COLUMN_LIMIT = 60;

interface Fixture {
  readonly name: string;
  readonly input: string;
  readonly expected: string;
}

const fixtures: readonly Fixture[] = [
  { name: '001-javadoc-param-return', input: javadocIn, expected: javadocOut },
  { name: '002-plain-narrative', input: plainIn, expected: plainOut },
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

let parserManager: ParserManager;

beforeAll(async () => {
  parserManager = await createTestParserManager(javaAdapter);
});

describe('Java docComment (Javadoc) wrapping — end-to-end gold fixtures', () => {
  it.each(fixtures.map((f) => [f.name, f] as const))('%s', async (_name, fixture) => {
    const result = await wrapRegions(fixture.input, 'java', 'all', config(), parserManager);
    const actual = applyTextEdits(fixture.input, result.edits);
    expect(actual).toBe(fixture.expected);
  });

  it('keeps @param/@return tags on their own lines, never merged with the summary', () => {
    expect(javadocOut).toMatch(/@param name/);
    expect(javadocOut).toMatch(/@return/);
  });

  it('falls back to plain paragraph reflow when no tag is present', () => {
    expect(plainOut).not.toMatch(/@param|@return/);
  });

  it('produces no line over the column limit for any fixture', async () => {
    for (const fixture of fixtures) {
      const result = await wrapRegions(fixture.input, 'java', 'all', config(), parserManager);
      const actual = applyTextEdits(fixture.input, result.edits);
      for (const line of actual.split('\n')) {
        expect(line.length).toBeLessThanOrEqual(COLUMN_LIMIT);
      }
    }
  });

  it('is idempotent: re-wrapping the gold output produces no further edits', async () => {
    for (const fixture of fixtures) {
      const result = await wrapRegions(fixture.expected, 'java', 'all', config(), parserManager);
      expect(result.edits).toEqual([]);
    }
  });
});
