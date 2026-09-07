import { beforeAll, describe, expect, it } from 'vitest';
import { createTestParserManager } from '../helpers/create-test-parser-manager.js';
import { applyTextEdits } from '../../src/apply-edits.js';
import { ParserManager } from '../../src/parser/parser-manager.js';
import type { WrapConfig } from '../../src/types/config.js';
import { typescriptAdapter } from '../../src/languages/typescript/adapter.js';
import { wrapRegions } from '../../src/wrap.js';
import { extractConcatenatedStringValue } from '../support/decode-js-string.js';

import longProseIn from '../fixtures/typescript/strings/001-long-prose-message.in.ts?raw';
import longProseOut from '../fixtures/typescript/strings/001-long-prose-message.out.ts?raw';
import needsNoParensIn from '../fixtures/typescript/strings/002-needs-parens-not-required.in.ts?raw';
import needsNoParensOut from '../fixtures/typescript/strings/002-needs-parens-not-required.out.ts?raw';
import negSqlIn from '../fixtures/typescript/strings/neg-001-sql-query.in.ts?raw';
import negSqlOut from '../fixtures/typescript/strings/neg-001-sql-query.out.ts?raw';
import negUrlIn from '../fixtures/typescript/strings/neg-002-url.in.ts?raw';
import negUrlOut from '../fixtures/typescript/strings/neg-002-url.out.ts?raw';
import negPathIn from '../fixtures/typescript/strings/neg-003-path-literal.in.ts?raw';
import negPathOut from '../fixtures/typescript/strings/neg-003-path-literal.out.ts?raw';
import negRegexIn from '../fixtures/typescript/strings/neg-004-regex-pattern.in.ts?raw';
import negRegexOut from '../fixtures/typescript/strings/neg-004-regex-pattern.out.ts?raw';
import negDictKeyIn from '../fixtures/typescript/strings/neg-005-dict-key.in.ts?raw';
import negDictKeyOut from '../fixtures/typescript/strings/neg-005-dict-key.out.ts?raw';
import negI18nIn from '../fixtures/typescript/strings/neg-006-i18n-key.in.ts?raw';
import negI18nOut from '../fixtures/typescript/strings/neg-006-i18n-key.out.ts?raw';
import negLoggingIn from '../fixtures/typescript/strings/neg-007-logging-format-string.in.ts?raw';
import negLoggingOut from '../fixtures/typescript/strings/neg-007-logging-format-string.out.ts?raw';

/**
 * TypeScript's own string-wrapping gold fixtures -- mirrors
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
  { name: 'neg-003-path-literal', input: negPathIn, expected: negPathOut, positive: false },
  { name: 'neg-004-regex-pattern', input: negRegexIn, expected: negRegexOut, positive: false },
  { name: 'neg-005-dict-key', input: negDictKeyIn, expected: negDictKeyOut, positive: false },
  { name: 'neg-006-i18n-key', input: negI18nIn, expected: negI18nOut, positive: false },
  {
    name: 'neg-007-logging-format-string',
    input: negLoggingIn,
    expected: negLoggingOut,
    positive: false,
  },
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
  parserManager = await createTestParserManager(typescriptAdapter);
});

describe('TypeScript string-literal wrapping -- end-to-end gold fixtures', () => {
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

  it("eval-equivalence: every positive fixture's wrapped value equals its original value", () => {
    // Same oracle as `./javascript-string-wrap-fixtures.test.ts`: TS string
    // literal syntax (type annotations aside, which the decoder never
    // needs to see) is the same as JS's, so the JS eval-based oracle
    // applies unchanged.
    for (const fixture of fixtures.filter((f) => f.positive)) {
      const before = extractConcatenatedStringValue(fixture.input);
      const after = extractConcatenatedStringValue(fixture.expected);
      expect(after).toBe(before);
    }
  });

  it('negative fixtures also round-trip through the decoder unchanged (a sanity check on the oracle itself)', () => {
    for (const fixture of fixtures.filter((f) => !f.positive)) {
      const before = extractConcatenatedStringValue(fixture.input);
      const after = extractConcatenatedStringValue(fixture.expected);
      expect(after).toBe(before);
    }
  });

  it('an empty string literal keeps its delimiters even when forced to wrap (regression)', async () => {
    // See `./python-string-wrap-fixtures.test.ts`'s identical regression
    // test for the full rationale: a sibling implementation once
    // rewrapped an empty string literal into a bare, delimiter-less
    // sequence, deleting it entirely and producing invalid syntax.
    // `stringPolicy: 'all'` bypasses the prose gate (`''` never scores as
    // prose, so it'd otherwise never reach `wrapString` at all) to
    // exercise the real guard in the shared `strings/emit-string.ts`.
    for (const source of ['const x: string = "";\n', "const x: string = '';\n"]) {
      const result = await wrapRegions(
        source,
        'typescript',
        'all',
        config({ stringPolicy: 'all' }),
        parserManager,
      );
      const actual = applyTextEdits(source, result.edits);
      expect(actual).toBe(source);
    }
  });
});
