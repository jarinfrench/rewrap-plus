import { beforeAll, describe, expect, it } from 'vitest';
import { createTestParserManager } from '../helpers/create-test-parser-manager.js';
import { applyTextEdits } from '../../src/apply-edits.js';
import { ParserManager } from '../../src/parser/parser-manager.js';
import type { WrapConfig } from '../../src/types/config.js';
import { cppAdapter } from '../../src/languages/cpp/adapter.js';
import { wrapRegions } from '../../src/wrap.js';
import { extractConcatenatedStringValue } from '../support/decode-cpp-string.js';

import longProseIn from '../fixtures/cpp/strings/001-long-prose-message.in.cpp?raw';
import longProseOut from '../fixtures/cpp/strings/001-long-prose-message.out.cpp?raw';
import rebalancedIn from '../fixtures/cpp/strings/002-existing-concat-rebalanced.in.cpp?raw';
import rebalancedOut from '../fixtures/cpp/strings/002-existing-concat-rebalanced.out.cpp?raw';
import alreadyWrappedIn from '../fixtures/cpp/strings/003-already-correctly-wrapped-byte-identical.in.cpp?raw';
import alreadyWrappedOut from '../fixtures/cpp/strings/003-already-correctly-wrapped-byte-identical.out.cpp?raw';
import hexEscapeIn from '../fixtures/cpp/strings/004-multi-digit-hex-escape.in.cpp?raw';
import hexEscapeOut from '../fixtures/cpp/strings/004-multi-digit-hex-escape.out.cpp?raw';
import negSqlIn from '../fixtures/cpp/strings/neg-001-sql-query.in.cpp?raw';
import negSqlOut from '../fixtures/cpp/strings/neg-001-sql-query.out.cpp?raw';
import negRawIn from '../fixtures/cpp/strings/neg-002-raw-string.in.cpp?raw';
import negRawOut from '../fixtures/cpp/strings/neg-002-raw-string.out.cpp?raw';
import negUrlIn from '../fixtures/cpp/strings/neg-003-url.in.cpp?raw';
import negUrlOut from '../fixtures/cpp/strings/neg-003-url.out.cpp?raw';
import negPathIn from '../fixtures/cpp/strings/neg-004-path-literal.in.cpp?raw';
import negPathOut from '../fixtures/cpp/strings/neg-004-path-literal.out.cpp?raw';
import negRegexIn from '../fixtures/cpp/strings/neg-005-regex-pattern.in.cpp?raw';
import negRegexOut from '../fixtures/cpp/strings/neg-005-regex-pattern.out.cpp?raw';
import negDictKeyIn from '../fixtures/cpp/strings/neg-006-dict-key.in.cpp?raw';
import negDictKeyOut from '../fixtures/cpp/strings/neg-006-dict-key.out.cpp?raw';
import negI18nIn from '../fixtures/cpp/strings/neg-007-i18n-key.in.cpp?raw';
import negI18nOut from '../fixtures/cpp/strings/neg-007-i18n-key.out.cpp?raw';
import negLoggingIn from '../fixtures/cpp/strings/neg-008-logging-format-string.in.cpp?raw';
import negLoggingOut from '../fixtures/cpp/strings/neg-008-logging-format-string.out.cpp?raw';

/**
 * String-wrapping gold fixtures for the C++ adapter -- mirrors
 * `./javascript-string-wrap-fixtures.test.ts`'s structure and
 * rationale, proving the *shared* `strings/dissolve-string.ts`/
 * `strings/emit-string.ts` behaves correctly for C++'s `'implicit'`-only,
 * no-grouping-required, no-operator-style concatenation -- a third real
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
  {
    // Regression for a confirmed string-corruption bug: C++'s `\x` hex
    // escape consumes however many hex digits follow (unlike Python's
    // fixed 2), and `findUnbreakableSpans`'s escape pattern only
    // recognized the first 2 before this fixture existed -- a wrap
    // landing right after those 2 digits split `\x1234` (one character,
    // value 0x1234) into `\x12` (0x12) concatenated with literal `34`,
    // silently changing the string's value. The padding in this
    // fixture's input is deliberately tuned so the greedy wrap boundary
    // lands exactly inside the escape under the old (buggy) pattern --
    // confirmed directly by temporarily reverting the fix and observing
    // this exact input produce `L"...\x12" L"34..."`. See
    // `../../src/segmentation/unbreakable-spans.ts`'s own doc comment on
    // `ESCAPE_SEQUENCE` for the full writeup.
    name: '004-multi-digit-hex-escape',
    input: hexEscapeIn,
    expected: hexEscapeOut,
    positive: true,
  },
  { name: 'neg-001-sql-query', input: negSqlIn, expected: negSqlOut, positive: false },
  { name: 'neg-002-raw-string', input: negRawIn, expected: negRawOut, positive: false },
  { name: 'neg-003-url', input: negUrlIn, expected: negUrlOut, positive: false },
  { name: 'neg-004-path-literal', input: negPathIn, expected: negPathOut, positive: false },
  { name: 'neg-005-regex-pattern', input: negRegexIn, expected: negRegexOut, positive: false },
  { name: 'neg-006-dict-key', input: negDictKeyIn, expected: negDictKeyOut, positive: false },
  { name: 'neg-007-i18n-key', input: negI18nIn, expected: negI18nOut, positive: false },
  {
    name: 'neg-008-logging-format-string',
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
  parserManager = await createTestParserManager(cppAdapter);
});

describe('C++ string-literal wrapping -- end-to-end gold fixtures', () => {
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

  it('never inserts a concatenation operator -- bare adjacency is C++\'s only real join syntax', async () => {
    for (const fixture of fixtures.filter((f) => f.positive)) {
      const result = await wrapRegions(fixture.input, 'cpp', 'all', config(), parserManager);
      for (const edit of result.edits) {
        expect(edit.newText).not.toMatch(/"\s*\+\s*"/);
      }
    }
  });

  it('never requires inserted parens -- bare adjacency needs no grouping', async () => {
    for (const fixture of fixtures.filter((f) => f.positive)) {
      const result = await wrapRegions(fixture.input, 'cpp', 'all', config(), parserManager);
      for (const edit of result.edits) {
        expect(edit.newText).not.toMatch(/^\(/);
      }
    }
  });

  it("eval-equivalence: every positive fixture's wrapped value equals its original value", () => {
    // C++'s counterpart to `./python-string-wrap-fixtures.test.ts`'s own
    // eval-equivalence check. No C++ compiler is available in this
    // project's toolchain (nor should one need to be) --
    // `extractConcatenatedStringValue` reimplements just enough of C++'s
    // own escape decoding as a test-only oracle; see
    // `../support/decode-cpp-string.ts` for the full rationale.
    for (const fixture of fixtures.filter((f) => f.positive)) {
      const before = extractConcatenatedStringValue(fixture.input);
      const after = extractConcatenatedStringValue(fixture.expected);
      expect(after).toBe(before);
    }
  });

  it('negative fixtures also round-trip through the decoder unchanged (a sanity check on the oracle itself)', () => {
    for (const fixture of fixtures.filter((f) => !f.positive && f.name !== 'neg-002-raw-string')) {
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
    const source = 'void f() {\n  const char* x = "";\n}\n';
    const result = await wrapRegions(
      source,
      'cpp',
      'all',
      config({ stringPolicy: 'all' }),
      parserManager,
    );
    const actual = applyTextEdits(source, result.edits);
    expect(actual).toBe(source);
  });
});
