import { beforeAll, describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../../src/adapter-registry.js';
import { applyTextEdits } from '../../src/apply-edits.js';
import { ParserManager } from '../../src/parser/parser-manager.js';
import type { WrapConfig } from '../../src/types/config.js';
import { pythonAdapter } from '../../src/languages/python/adapter.js';
import { wrapRegions } from '../../src/wrap.js';
import { extractConcatenatedStringValue } from '../support/decode-python-string.js';

import longProseIn from '../fixtures/python/strings/001-long-prose-message.in.py?raw';
import longProseOut from '../fixtures/python/strings/001-long-prose-message.out.py?raw';
import rebalancedIn from '../fixtures/python/strings/002-existing-concat-rebalanced.in.py?raw';
import rebalancedOut from '../fixtures/python/strings/002-existing-concat-rebalanced.out.py?raw';
import fstringIn from '../fixtures/python/strings/003-fstring-interpolation.in.py?raw';
import fstringOut from '../fixtures/python/strings/003-fstring-interpolation.out.py?raw';
import needsParensIn from '../fixtures/python/strings/004-needs-parens-return.in.py?raw';
import needsParensOut from '../fixtures/python/strings/004-needs-parens-return.out.py?raw';
import alreadyGroupedIn from '../fixtures/python/strings/005-already-grouped-call-arg.in.py?raw';
import alreadyGroupedOut from '../fixtures/python/strings/005-already-grouped-call-arg.out.py?raw';
import operatorStyleIn from '../fixtures/python/strings/006-operator-style-preserved.in.py?raw';
import operatorStyleOut from '../fixtures/python/strings/006-operator-style-preserved.out.py?raw';
import alreadyWrappedIn from '../fixtures/python/strings/007-already-correctly-wrapped-byte-identical.in.py?raw';
import alreadyWrappedOut from '../fixtures/python/strings/007-already-correctly-wrapped-byte-identical.out.py?raw';

import negSqlIn from '../fixtures/python/strings/neg-001-sql-query.in.py?raw';
import negSqlOut from '../fixtures/python/strings/neg-001-sql-query.out.py?raw';
import negRegexIn from '../fixtures/python/strings/neg-002-regex-pattern.in.py?raw';
import negRegexOut from '../fixtures/python/strings/neg-002-regex-pattern.out.py?raw';
import negUrlIn from '../fixtures/python/strings/neg-003-url.in.py?raw';
import negUrlOut from '../fixtures/python/strings/neg-003-url.out.py?raw';
import negDictKeyIn from '../fixtures/python/strings/neg-004-dict-key.in.py?raw';
import negDictKeyOut from '../fixtures/python/strings/neg-004-dict-key.out.py?raw';
import negI18nIn from '../fixtures/python/strings/neg-005-i18n-key.in.py?raw';
import negI18nOut from '../fixtures/python/strings/neg-005-i18n-key.out.py?raw';
import negLoggingIn from '../fixtures/python/strings/neg-006-logging-format-string.in.py?raw';
import negLoggingOut from '../fixtures/python/strings/neg-006-logging-format-string.out.py?raw';
import negPathIn from '../fixtures/python/strings/neg-007-path-literal.in.py?raw';
import negPathOut from '../fixtures/python/strings/neg-007-path-literal.out.py?raw';
import negRawIn from '../fixtures/python/strings/neg-008-raw-string.in.py?raw';
import negRawOut from '../fixtures/python/strings/neg-008-raw-string.out.py?raw';
import negWhitespaceIn from '../fixtures/python/strings/neg-009-irregular-whitespace.in.py?raw';
import negWhitespaceOut from '../fixtures/python/strings/neg-009-irregular-whitespace.out.py?raw';
import negTripleQuoteIn from '../fixtures/python/strings/neg-010-triple-quoted-ordinary-string.in.py?raw';
import negTripleQuoteOut from '../fixtures/python/strings/neg-010-triple-quoted-ordinary-string.out.py?raw';
import negLineContinuationIn from '../fixtures/python/strings/neg-011-line-continuation.in.py?raw';
import negLineContinuationOut from '../fixtures/python/strings/neg-011-line-continuation.out.py?raw';

/**
 * Phase 9's stated acceptance criterion: "All string fixtures pass; the
 * eval-equivalence test passes for every wrapped string; every negative
 * fixture is byte-identical after wrapping." Mirrors
 * `./python-docstring-wrap-fixtures.test.ts`'s own structure and
 * rationale for this project's established fixture-driven convention.
 *
 * `stringPolicy: 'prose'` (not `'all'`) is the config every fixture below
 * runs under — the conservative, recommended default — precisely so the
 * negative fixtures exercise the real gate a user would actually hit,
 * not a hypothetical one only reachable by deliberately disabling it.
 */
const COLUMN_LIMIT = 60;

interface Fixture {
  readonly name: string;
  readonly input: string;
  readonly expected: string;
  /** `true` for a fixture the plan expects to actually be wrapped. */
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
  { name: '003-fstring-interpolation', input: fstringIn, expected: fstringOut, positive: true },
  { name: '004-needs-parens-return', input: needsParensIn, expected: needsParensOut, positive: true },
  {
    name: '005-already-grouped-call-arg',
    input: alreadyGroupedIn,
    expected: alreadyGroupedOut,
    positive: true,
  },
  {
    name: '006-operator-style-preserved',
    input: operatorStyleIn,
    expected: operatorStyleOut,
    positive: true,
  },
  {
    name: '007-already-correctly-wrapped-byte-identical',
    input: alreadyWrappedIn,
    expected: alreadyWrappedOut,
    positive: true,
  },
  { name: 'neg-001-sql-query', input: negSqlIn, expected: negSqlOut, positive: false },
  { name: 'neg-002-regex-pattern', input: negRegexIn, expected: negRegexOut, positive: false },
  { name: 'neg-003-url', input: negUrlIn, expected: negUrlOut, positive: false },
  { name: 'neg-004-dict-key', input: negDictKeyIn, expected: negDictKeyOut, positive: false },
  { name: 'neg-005-i18n-key', input: negI18nIn, expected: negI18nOut, positive: false },
  {
    name: 'neg-006-logging-format-string',
    input: negLoggingIn,
    expected: negLoggingOut,
    positive: false,
  },
  { name: 'neg-007-path-literal', input: negPathIn, expected: negPathOut, positive: false },
  { name: 'neg-008-raw-string', input: negRawIn, expected: negRawOut, positive: false },
  {
    name: 'neg-009-irregular-whitespace',
    input: negWhitespaceIn,
    expected: negWhitespaceOut,
    positive: false,
  },
  {
    name: 'neg-010-triple-quoted-ordinary-string',
    input: negTripleQuoteIn,
    expected: negTripleQuoteOut,
    positive: false,
  },
  {
    name: 'neg-011-line-continuation',
    input: negLineContinuationIn,
    expected: negLineContinuationOut,
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

// `.` resolves against Vitest's cwd (this package's root) — see
// `../../src/parser/parser-manager.test.ts` for the same pattern.
const engineRoot = '.';

let parserManager: ParserManager;

beforeAll(async () => {
  const registry = new AdapterRegistry();
  registry.register(pythonAdapter);
  parserManager = await ParserManager.create({ wasmDir: engineRoot, registry });
});

describe('Python string-literal wrapping — end-to-end gold fixtures', () => {
  it.each(fixtures.map((f) => [f.name, f] as const))('%s', async (_name, fixture) => {
    const result = await wrapRegions(fixture.input, 'python', 'all', config(), parserManager);
    const actual = applyTextEdits(fixture.input, result.edits);
    expect(actual).toBe(fixture.expected);
  });

  it('every negative fixture is byte-identical between .in and .out', () => {
    for (const fixture of fixtures.filter((f) => !f.positive)) {
      expect(fixture.input).toBe(fixture.expected);
    }
  });

  it('every positive fixture actually changes the source, except the already-wrapped one (proves the gate really fires)', () => {
    for (const fixture of fixtures.filter((f) => f.positive)) {
      if (fixture.name === '007-already-correctly-wrapped-byte-identical') {
        expect(fixture.expected).toBe(fixture.input); // the whole point of this one
        continue;
      }
      expect(fixture.expected).not.toBe(fixture.input);
    }
  });

  it('produces no line over the column limit for any positive fixture', async () => {
    for (const fixture of fixtures.filter((f) => f.positive)) {
      const result = await wrapRegions(fixture.input, 'python', 'all', config(), parserManager);
      const actual = applyTextEdits(fixture.input, result.edits);
      for (const line of actual.split('\n')) {
        expect(line.length).toBeLessThanOrEqual(COLUMN_LIMIT);
      }
    }
  });

  it('is idempotent: re-wrapping the gold output produces no further edits', async () => {
    for (const fixture of fixtures) {
      const result = await wrapRegions(fixture.expected, 'python', 'all', config(), parserManager);
      expect(result.edits).toEqual([]);
    }
  });

  it("eval-equivalence: every positive fixture's wrapped value equals its original value", () => {
    // The plan's own strongest guard against silent corruption: "eval
    // the string expression before and after and assert equality." No
    // Python interpreter is available in this project's toolchain (nor
    // should one need to be, for a TypeScript engine with zero runtime
    // dependencies) — `extractConcatenatedStringValue` reimplements just
    // enough of Python's own escape decoding, as a test-only oracle
    // independent of the engine's own (deliberately non-decoding)
    // dissolve/emit code, to make this comparison meaningful. See that
    // module's own doc comment for the full rationale.
    for (const fixture of fixtures.filter((f) => f.positive)) {
      const before = extractConcatenatedStringValue(fixture.input);
      const after = extractConcatenatedStringValue(fixture.expected);
      expect(after).toBe(before);
    }
  });

  it("negative fixtures also round-trip through the decoder unchanged (a sanity check on the oracle itself)", () => {
    for (const fixture of fixtures.filter((f) => !f.positive && f.name !== 'neg-008-raw-string')) {
      const before = extractConcatenatedStringValue(fixture.input);
      const after = extractConcatenatedStringValue(fixture.expected);
      expect(after).toBe(before);
    }
  });

  it('covers the cases the plan calls out for this phase', () => {
    // Not a behavioral assertion — a guard against silently losing
    // coverage of one of these named cases if a fixture were ever
    // renamed or removed without a replacement.
    expect(fixtures.map((f) => f.name)).toEqual([
      '001-long-prose-message',
      '002-existing-concat-rebalanced',
      '003-fstring-interpolation',
      '004-needs-parens-return',
      '005-already-grouped-call-arg',
      '006-operator-style-preserved',
      '007-already-correctly-wrapped-byte-identical',
      'neg-001-sql-query',
      'neg-002-regex-pattern',
      'neg-003-url',
      'neg-004-dict-key',
      'neg-005-i18n-key',
      'neg-006-logging-format-string',
      'neg-007-path-literal',
      'neg-008-raw-string',
      'neg-009-irregular-whitespace',
      'neg-010-triple-quoted-ordinary-string',
      'neg-011-line-continuation',
    ]);
  });
});
