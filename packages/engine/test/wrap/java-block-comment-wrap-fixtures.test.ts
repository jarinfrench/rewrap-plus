import { beforeAll, describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../../src/adapter-registry.js';
import { applyTextEdits } from '../../src/apply-edits.js';
import { ParserManager } from '../../src/parser/parser-manager.js';
import type { WrapConfig } from '../../src/types/config.js';
import { javaAdapter } from '../../src/languages/java/adapter.js';
import { wrapRegions } from '../../src/wrap.js';

import plainIn from '../fixtures/java/block-comments/001-plain-narrative.in.java?raw';
import plainOut from '../fixtures/java/block-comments/001-plain-narrative.out.java?raw';

/**
 * Gold fixtures for a plain single-star `/* ... * /` `'blockComment'`
 * region (no Javadoc marker) — `descriptor.comments.plainBlock`'s
 * distinct open delimiter, dissolved/emitted through
 * `dissolveBlockComments`/`emitBlockComments`
 * (`../../src/comments/dissolve-block-comments.ts`,
 * `../../src/comments/emit-block-comments.ts`), end to end via
 * `wrapRegions`. Mirrors this package's established fixture-driven
 * convention (`./cpp-block-comment-wrap-fixtures.test.ts`).
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

const engineRoot = '.';

let parserManager: ParserManager;

beforeAll(async () => {
  const registry = new AdapterRegistry();
  registry.register(javaAdapter);
  parserManager = await ParserManager.create({ wasmDir: engineRoot, registry });
});

describe('Java blockComment (plain /* */) wrapping — end-to-end gold fixtures', () => {
  it.each(fixtures.map((f) => [f.name, f] as const))('%s', async (_name, fixture) => {
    const result = await wrapRegions(fixture.input, 'java', 'all', config(), parserManager);
    const actual = applyTextEdits(fixture.input, result.edits);
    expect(actual).toBe(fixture.expected);
  });

  it('uses a single-star open delimiter, never the Javadoc /**', () => {
    expect(plainOut).toContain('    /*\n');
    expect(plainOut).not.toContain('/**');
  });

  it('produces no line over the column limit', async () => {
    const result = await wrapRegions(plainIn, 'java', 'all', config(), parserManager);
    const actual = applyTextEdits(plainIn, result.edits);
    for (const line of actual.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(COLUMN_LIMIT);
    }
  });

  it('is idempotent: re-wrapping the gold output produces no further edits', async () => {
    const result = await wrapRegions(plainOut, 'java', 'all', config(), parserManager);
    expect(result.edits).toEqual([]);
  });
});
