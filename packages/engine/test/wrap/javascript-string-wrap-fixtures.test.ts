import { beforeAll, describe, expect, it } from 'vitest';
import { createTestParserManager } from '../helpers/create-test-parser-manager.js';
import { applyTextEdits } from '../../src/apply-edits.js';
import { ParserManager } from '../../src/parser/parser-manager.js';
import type { WrapConfig } from '../../src/types/config.js';
import { javascriptAdapter } from '../../src/languages/javascript/adapter.js';
import { wrapRegions } from '../../src/wrap.js';
import { extractConcatenatedStringValue } from '../support/decode-js-string.js';

import longProseIn from '../fixtures/javascript/strings/001-long-prose-message.in.js?raw';
import longProseOut from '../fixtures/javascript/strings/001-long-prose-message.out.js?raw';
import rebalancedIn from '../fixtures/javascript/strings/002-existing-concat-rebalanced.in.js?raw';
import rebalancedOut from '../fixtures/javascript/strings/002-existing-concat-rebalanced.out.js?raw';
import alreadyWrappedIn from '../fixtures/javascript/strings/003-already-correctly-wrapped-byte-identical.in.js?raw';
import alreadyWrappedOut from '../fixtures/javascript/strings/003-already-correctly-wrapped-byte-identical.out.js?raw';
import codepointEscapeIn from '../fixtures/javascript/strings/004-codepoint-escape.in.js?raw';
import codepointEscapeOut from '../fixtures/javascript/strings/004-codepoint-escape.out.js?raw';
import negSqlIn from '../fixtures/javascript/strings/neg-001-sql-query.in.js?raw';
import negSqlOut from '../fixtures/javascript/strings/neg-001-sql-query.out.js?raw';
import negUrlIn from '../fixtures/javascript/strings/neg-002-url.in.js?raw';
import negUrlOut from '../fixtures/javascript/strings/neg-002-url.out.js?raw';
import negPathIn from '../fixtures/javascript/strings/neg-003-path-literal.in.js?raw';
import negPathOut from '../fixtures/javascript/strings/neg-003-path-literal.out.js?raw';
import negRegexIn from '../fixtures/javascript/strings/neg-004-regex-pattern.in.js?raw';
import negRegexOut from '../fixtures/javascript/strings/neg-004-regex-pattern.out.js?raw';
import negDictKeyIn from '../fixtures/javascript/strings/neg-005-dict-key.in.js?raw';
import negDictKeyOut from '../fixtures/javascript/strings/neg-005-dict-key.out.js?raw';
import negI18nIn from '../fixtures/javascript/strings/neg-006-i18n-key.in.js?raw';
import negI18nOut from '../fixtures/javascript/strings/neg-006-i18n-key.out.js?raw';
import negLoggingIn from '../fixtures/javascript/strings/neg-007-logging-format-string.in.js?raw';
import negLoggingOut from '../fixtures/javascript/strings/neg-007-logging-format-string.out.js?raw';

/**
 * String-wrapping gold fixtures for the now-full JavaScript adapter —
 * mirrors `./python-string-wrap-fixtures.test.ts`'s structure and
 * rationale, proving the *shared* `strings/dissolve-string.ts`/
 * `strings/emit-string.ts` (promoted out of `languages/python/` as part
 * of this same effort) behaves identically for JS/TS's `'operator'`-only,
 * no-grouping-required
 * concatenation as it does for Python's `'implicit'`/`'operator'` pair.
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
    // Regression for a confirmed bug worse than the C++ hex-escape one
    // (`../../src/segmentation/unbreakable-spans.ts`'s own doc comment on
    // `ESCAPE_SEQUENCE`): the ES2015 `\u{...}` code-point escape (used for
    // emoji and any character outside the BMP) had no representation at
    // all in `findUnbreakableSpans` before this fixture existed, so a wrap
    // could land between `\u` and `{1F600}`. That doesn't just change the
    // string's value — `"...\u"` is a `SyntaxError` (`\u` not followed by
    // 4 hex digits or `{...}`), so the real `eval`-based oracle below
    // would have thrown, not merely disagreed. The padding in this
    // fixture's input is tuned so the greedy wrap boundary lands exactly
    // inside the escape under the old (buggy) pattern — confirmed
    // directly by temporarily reverting the fix and observing this exact
    // input produce `"...emoji \u" + "{1F600}..."`.
    name: '004-codepoint-escape',
    input: codepointEscapeIn,
    expected: codepointEscapeOut,
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
  parserManager = await createTestParserManager(javascriptAdapter);
});

describe('JavaScript string-literal wrapping — end-to-end gold fixtures', () => {
  it.each(fixtures.map((f) => [f.name, f] as const))('%s', async (_name, fixture) => {
    const result = await wrapRegions(fixture.input, 'javascript', 'all', config(), parserManager);
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

  it('never requires inserted parens — JS/TS operator concatenation needs no grouping', async () => {
    for (const fixture of fixtures.filter((f) => f.positive)) {
      const result = await wrapRegions(fixture.input, 'javascript', 'all', config(), parserManager);
      for (const edit of result.edits) {
        expect(edit.newText).not.toMatch(/^\(/);
      }
    }
  });

  it("eval-equivalence: every positive fixture's wrapped value equals its original value", () => {
    // The stated Phase 9 acceptance criterion, generalized past Python:
    // "eval the string expression before and after and assert equality."
    // `extractConcatenatedStringValue` literally evals the extracted string
    // tokens (real JS, unlike Python's oracle) — see that module's own doc
    // comment.
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
    for (const source of ['const x = "";\n', "const x = '';\n"]) {
      const result = await wrapRegions(
        source,
        'javascript',
        'all',
        config({ stringPolicy: 'all' }),
        parserManager,
      );
      const actual = applyTextEdits(source, result.edits);
      expect(actual).toBe(source);
    }
  });
});
