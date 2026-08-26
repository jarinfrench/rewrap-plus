import { beforeAll, describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../../src/adapter-registry.js';
import { applyTextEdits } from '../../src/apply-edits.js';
import { ParserManager } from '../../src/parser/parser-manager.js';
import type { WrapConfig } from '../../src/types/config.js';
import { javascriptAdapter } from '../../src/languages/javascript/adapter.js';
import { wrapRegions } from '../../src/wrap.js';

import jsdocIn from '../fixtures/javascript/doc-comments/001-jsdoc-param-returns.in.js?raw';
import jsdocOut from '../fixtures/javascript/doc-comments/001-jsdoc-param-returns.out.js?raw';
import plainIn from '../fixtures/javascript/doc-comments/002-plain-narrative.in.js?raw';
import plainOut from '../fixtures/javascript/doc-comments/002-plain-narrative.out.js?raw';

/**
 * Gold fixtures for `'docComment'` regions — the JSDoc
 * dialect (`../../src/docs/jsdoc.ts`) applied through the generic
 * `wrapDocComment` (`../../src/comments/wrap-doc-comment.ts`), end to end
 * via `wrapRegions`. Mirrors this package's established fixture-driven
 * convention (`./python-docstring-wrap-fixtures.test.ts`).
 */
const COLUMN_LIMIT = 60;

interface Fixture {
  readonly name: string;
  readonly input: string;
  readonly expected: string;
}

const fixtures: readonly Fixture[] = [
  { name: '001-jsdoc-param-returns', input: jsdocIn, expected: jsdocOut },
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

const engineRoot = '.';

let parserManager: ParserManager;

beforeAll(async () => {
  const registry = new AdapterRegistry();
  registry.register(javascriptAdapter);
  parserManager = await ParserManager.create({ wasmDir: engineRoot, registry });
});

describe('JavaScript docComment (JSDoc) wrapping — end-to-end gold fixtures', () => {
  it.each(fixtures.map((f) => [f.name, f] as const))('%s', async (_name, fixture) => {
    const result = await wrapRegions(fixture.input, 'javascript', 'all', config(), parserManager);
    const actual = applyTextEdits(fixture.input, result.edits);
    expect(actual).toBe(fixture.expected);
  });

  it('keeps @param/@returns tags on their own lines, never merged with the summary', () => {
    expect(jsdocOut).toMatch(/@param name/);
    expect(jsdocOut).toMatch(/@returns/);
  });

  it('falls back to plain paragraph reflow when no @tag is present', () => {
    expect(plainOut).not.toMatch(/@/);
  });

  it('produces no line over the column limit for any fixture', async () => {
    for (const fixture of fixtures) {
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
});
