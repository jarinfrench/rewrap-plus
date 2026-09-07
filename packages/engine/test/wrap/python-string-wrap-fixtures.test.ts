import { beforeAll, describe, expect, it } from 'vitest';
import { createTestParserManager } from '../helpers/create-test-parser-manager.js';
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
import tripleSingleLineIn from '../fixtures/python/strings/008-triple-quoted-single-line-prose.in.py?raw';
import tripleSingleLineOut from '../fixtures/python/strings/008-triple-quoted-single-line-prose.out.py?raw';
import tripleMultiLineIn from '../fixtures/python/strings/009-triple-quoted-multiline-prose.in.py?raw';
import tripleMultiLineOut from '../fixtures/python/strings/009-triple-quoted-multiline-prose.out.py?raw';

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
import negTripleCodeLikeIn from '../fixtures/python/strings/neg-012-triple-quoted-code-like.in.py?raw';
import negTripleCodeLikeOut from '../fixtures/python/strings/neg-012-triple-quoted-code-like.out.py?raw';

/**
 * The stated acceptance criterion: "All string fixtures pass; the
 * eval-equivalence test passes for every wrapped string; every negative
 * fixture is byte-identical after wrapping." Mirrors
 * `./python-docstring-wrap-fixtures.test.ts`'s own structure and
 * rationale for this project's established fixture-driven convention.
 *
 * `stringPolicy: 'prose'` (not `'all'`) is the config every fixture below
 * runs under -- the conservative, recommended default -- precisely so the
 * negative fixtures exercise the real gate a user would actually hit,
 * not a hypothetical one only reachable by deliberately disabling it.
 */
const COLUMN_LIMIT = 60;

interface Fixture {
  readonly name: string;
  readonly input: string;
  readonly expected: string;
  /** `true` for a fixture that's expected to actually be wrapped. */
  readonly positive: boolean;
  /**
   * `false` only for the two triple-quoted-prose fixtures (008,
   * 009) -- every other positive fixture goes through the concatenation-
   * based `wrapString` pipeline, which is value-preserving by construction
   * (`../../src/strings/dissolve-string.ts`'s own doc comment), so the
   * eval-equivalence check below is a meaningful test for it. A
   * triple-quoted non-docstring string instead goes through
   * `wrapCodeString`'s docstring-style pipeline
   * (`../../src/languages/python/wrap-code-string.ts`), which -- like
   * `wrapDocstring` itself -- applies real PEP-257 whitespace/indent
   * normalization, so "wrapped value equals original value" is not a
   * property this pipeline has, or claims to have; asserting it here would
   * be testing for the wrong invariant, not a stronger one. Defaults to
   * `true` via `positive` at each site below rather than every existing
   * fixture needing to spell it out.
   */
  readonly valuePreserving?: boolean;
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
  {
    name: '008-triple-quoted-single-line-prose',
    input: tripleSingleLineIn,
    expected: tripleSingleLineOut,
    positive: true,
    valuePreserving: false,
  },
  {
    name: '009-triple-quoted-multiline-prose',
    input: tripleMultiLineIn,
    expected: tripleMultiLineOut,
    positive: true,
    valuePreserving: false,
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
  {
    name: 'neg-012-triple-quoted-code-like',
    input: negTripleCodeLikeIn,
    expected: negTripleCodeLikeOut,
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
  parserManager = await createTestParserManager(pythonAdapter);
});

describe('Python string-literal wrapping -- end-to-end gold fixtures', () => {
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

  it("eval-equivalence: every value-preserving positive fixture's wrapped value equals its original value", () => {
    // The strongest guard against silent corruption: "eval
    // the string expression before and after and assert equality." No
    // Python interpreter is available in this project's toolchain (nor
    // should one need to be, for a TypeScript engine with zero runtime
    // dependencies) -- `extractConcatenatedStringValue` reimplements just
    // enough of Python's own escape decoding, as a test-only oracle
    // independent of the engine's own (deliberately non-decoding)
    // dissolve/emit code, to make this comparison meaningful. See that
    // module's own doc comment for the full rationale.
    //
    // Filtered to `valuePreserving` fixtures only (every one except
    // 008/009 -- see the `Fixture` interface's own doc comment
    // on that field): `extractConcatenatedStringValue` doesn't even
    // attempt to decode triple-quoted content (documented as out of scope
    // in `../support/decode-python-string.ts`), and more fundamentally,
    // 008/009's wrapped value is *not* equal to its original value by
    // design -- asserting equality for them would be asserting the wrong
    // thing, not a stricter version of the right thing.
    for (const fixture of fixtures.filter((f) => f.positive && f.valuePreserving !== false)) {
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

  it('an empty string literal keeps its delimiters even when forced to wrap (regression)', async () => {
    // Under the default `stringPolicy: 'prose'` config every other test in
    // this file runs under, an empty string never even reaches
    // `wrapString`: `looksLikeProse('')` is false (`../../src/prose-
    // heuristic.ts`), so it's skipped at the gate. That's real protection,
    // but it isn't what protects against the actual bug -- a sibling
    // implementation once rewrapped `x = ""` into the invalid `x =`,
    // silently deleting the string entirely. Forcing `stringPolicy: 'all'`
    // here bypasses the prose gate so this exercises the real guard:
    // `emitString`'s `lines[0] ?? ''` and `reflowBlock`'s own
    // `atoms.length === 0` fallback (`../../src/strings/emit-string.ts`,
    // `../../src/reflow/reflow-block.ts`) never letting `''`/`""`/`f""`
    // collapse to a bare, delimiter-less region.
    for (const source of ['x = ""\n', "x = ''\n", 'x = f""\n', 'x = rb""\n']) {
      const result = await wrapRegions(
        source,
        'python',
        'all',
        config({ stringPolicy: 'all' }),
        parserManager,
      );
      const actual = applyTextEdits(source, result.edits);
      expect(actual).toBe(source);
    }
  });

  it('covers the cases string wrapping is meant to handle', () => {
    // Not a behavioral assertion -- a guard against silently losing
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
      '008-triple-quoted-single-line-prose',
      '009-triple-quoted-multiline-prose',
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
      'neg-012-triple-quoted-code-like',
    ]);
  });
});
