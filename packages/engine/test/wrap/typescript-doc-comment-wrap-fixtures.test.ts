import { beforeAll, describe, expect, it } from 'vitest';
import { createTestParserManager } from '../helpers/create-test-parser-manager.js';
import { applyTextEdits } from '../../src/apply-edits.js';
import { ParserManager } from '../../src/parser/parser-manager.js';
import type { WrapConfig } from '../../src/types/config.js';
import { typescriptAdapter } from '../../src/languages/typescript/adapter.js';
import { wrapRegions } from '../../src/wrap.js';

import jsdocIn from '../fixtures/typescript/doc-comments/001-jsdoc-param-returns.in.ts?raw';
import jsdocOut from '../fixtures/typescript/doc-comments/001-jsdoc-param-returns.out.ts?raw';

const COLUMN_LIMIT = 60;

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
  parserManager = await createTestParserManager(typescriptAdapter);
});

describe('TypeScript docComment (JSDoc) wrapping -- end-to-end gold fixtures', () => {
  it('wraps a JSDoc-tagged function doc comment against the gold output', async () => {
    const result = await wrapRegions(jsdocIn, 'typescript', 'all', config(), parserManager);
    const actual = applyTextEdits(jsdocIn, result.edits);
    expect(actual).toBe(jsdocOut);
  });

  it('preserves the trailing space in "Hello, " + name inside the same file', () => {
    expect(jsdocOut).toContain('"Hello, " + name');
  });

  it('is idempotent: re-wrapping the gold output produces no further edits', async () => {
    const result = await wrapRegions(jsdocOut, 'typescript', 'all', config(), parserManager);
    expect(result.edits).toEqual([]);
  });
});
