import { beforeAll, describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../../src/adapter-registry.js';
import { applyTextEdits } from '../../src/apply-edits.js';
import { ParserManager } from '../../src/parser/parser-manager.js';
import type { WrapConfig } from '../../src/types/config.js';
import { cppAdapter } from '../../src/languages/cpp/adapter.js';
import { wrapRegions } from '../../src/wrap.js';

import doxygenIn from '../fixtures/cpp/doc-comments/001-doxygen-param-return.in.cpp?raw';
import doxygenOut from '../fixtures/cpp/doc-comments/001-doxygen-param-return.out.cpp?raw';
import plainIn from '../fixtures/cpp/doc-comments/002-plain-narrative.in.cpp?raw';
import plainOut from '../fixtures/cpp/doc-comments/002-plain-narrative.out.cpp?raw';

/**
 * Phase 12c's gold fixtures for `'docComment'` regions — the Doxygen
 * dialect (`../../src/docs/doxygen.ts`) applied through the existing
 * generic `wrapDocComment` (`../../src/comments/wrap-doc-comment.ts`),
 * end to end via `wrapRegions`. Mirrors this package's established
 * fixture-driven convention (`./javascript-doc-comment-wrap-fixtures.test.ts`).
 */
const COLUMN_LIMIT = 60;

interface Fixture {
  readonly name: string;
  readonly input: string;
  readonly expected: string;
}

const fixtures: readonly Fixture[] = [
  { name: '001-doxygen-param-return', input: doxygenIn, expected: doxygenOut },
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
  registry.register(cppAdapter);
  parserManager = await ParserManager.create({ wasmDir: engineRoot, registry });
});

describe('C++ docComment (Doxygen) wrapping — end-to-end gold fixtures', () => {
  it.each(fixtures.map((f) => [f.name, f] as const))('%s', async (_name, fixture) => {
    const result = await wrapRegions(fixture.input, 'cpp', 'all', config(), parserManager);
    const actual = applyTextEdits(fixture.input, result.edits);
    expect(actual).toBe(fixture.expected);
  });

  it('keeps \\param/\\return tags on their own lines, never merged with the summary', () => {
    expect(doxygenOut).toMatch(/\\param name/);
    expect(doxygenOut).toMatch(/\\return/);
  });

  it('falls back to plain paragraph reflow when no tag is present', () => {
    expect(plainOut).not.toMatch(/\\param|\\return|@param|@return/);
  });

  it('produces no line over the column limit for any fixture', async () => {
    for (const fixture of fixtures) {
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
});
