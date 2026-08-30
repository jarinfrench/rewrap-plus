import { beforeAll, describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../../src/adapter-registry.js';
import { applyTextEdits } from '../../src/apply-edits.js';
import { ParserManager } from '../../src/parser/parser-manager.js';
import type { WrapConfig } from '../../src/types/config.js';
import { javaAdapter } from '../../src/languages/java/adapter.js';
import { wrapRegions } from '../../src/wrap.js';
import { extractConcatenatedStringValue } from '../support/decode-java-string.js';

import longProseIn from '../fixtures/java/strings/001-long-prose-message.in.java?raw';
import longProseOut from '../fixtures/java/strings/001-long-prose-message.out.java?raw';
import rebalancedIn from '../fixtures/java/strings/002-existing-concat-rebalanced.in.java?raw';
import rebalancedOut from '../fixtures/java/strings/002-existing-concat-rebalanced.out.java?raw';
import alreadyWrappedIn from '../fixtures/java/strings/003-already-correctly-wrapped-byte-identical.in.java?raw';
import alreadyWrappedOut from '../fixtures/java/strings/003-already-correctly-wrapped-byte-identical.out.java?raw';
import negSqlIn from '../fixtures/java/strings/neg-001-sql-query.in.java?raw';
import negSqlOut from '../fixtures/java/strings/neg-001-sql-query.out.java?raw';
import negUrlIn from '../fixtures/java/strings/neg-002-url.in.java?raw';
import negUrlOut from '../fixtures/java/strings/neg-002-url.out.java?raw';
import negPathIn from '../fixtures/java/strings/neg-003-path-literal.in.java?raw';
import negPathOut from '../fixtures/java/strings/neg-003-path-literal.out.java?raw';
import negTextBlockIn from '../fixtures/java/strings/neg-004-text-block.in.java?raw';
import negTextBlockOut from '../fixtures/java/strings/neg-004-text-block.out.java?raw';
import negRegexIn from '../fixtures/java/strings/neg-005-regex-pattern.in.java?raw';
import negRegexOut from '../fixtures/java/strings/neg-005-regex-pattern.out.java?raw';
import negDictKeyIn from '../fixtures/java/strings/neg-006-dict-key.in.java?raw';
import negDictKeyOut from '../fixtures/java/strings/neg-006-dict-key.out.java?raw';
import negI18nIn from '../fixtures/java/strings/neg-007-i18n-key.in.java?raw';
import negI18nOut from '../fixtures/java/strings/neg-007-i18n-key.out.java?raw';
import negLoggingIn from '../fixtures/java/strings/neg-008-logging-format-string.in.java?raw';
import negLoggingOut from '../fixtures/java/strings/neg-008-logging-format-string.out.java?raw';

/**
 * String-wrapping gold fixtures for the Java adapter — mirrors
 * `./javascript-string-wrap-fixtures.test.ts`'s structure and rationale,
 * proving the *shared* `strings/dissolve-string.ts`/`strings/emit-string.ts`
 * behaves correctly for Java's `'operator'`-only, no-grouping-required
 * concatenation, the identical shape JS/TS already exercise it through.
 *
 * `neg-004-text-block` is Java-specific, with no JS/TS/C++/Python
 * counterpart: a text block deliberately written *over* the column limit,
 * asserting zero edits *and* zero skipped regions — not merely "refused
 * by the prose heuristic" (`neg-001`/`neg-002`/`neg-003`'s own shape,
 * where a region is discovered but declines to wrap) but "never
 * discovered at all," proving `javaAdapter`'s `classify` excludes a text
 * block before `wrapRegions` ever sees it as a candidate — see
 * `../../src/languages/java/adapter.ts`'s own doc comment.
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
  { name: 'neg-001-sql-query', input: negSqlIn, expected: negSqlOut, positive: false },
  { name: 'neg-002-url', input: negUrlIn, expected: negUrlOut, positive: false },
  { name: 'neg-003-path-literal', input: negPathIn, expected: negPathOut, positive: false },
  { name: 'neg-004-text-block', input: negTextBlockIn, expected: negTextBlockOut, positive: false },
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

const engineRoot = '.';

let parserManager: ParserManager;

beforeAll(async () => {
  const registry = new AdapterRegistry();
  registry.register(javaAdapter);
  parserManager = await ParserManager.create({ wasmDir: engineRoot, registry });
});

describe('Java string-literal wrapping — end-to-end gold fixtures', () => {
  it.each(fixtures.map((f) => [f.name, f] as const))('%s', async (_name, fixture) => {
    const result = await wrapRegions(fixture.input, 'java', 'all', config(), parserManager);
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

  it('the text-block negative fixture is never even discovered as a candidate region', async () => {
    const result = await wrapRegions(negTextBlockIn, 'java', 'all', config(), parserManager);
    expect(result.edits).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it('produces no line over the column limit for any positive fixture', async () => {
    for (const fixture of fixtures.filter((f) => f.positive)) {
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

  it('never requires inserted parens — Java operator concatenation needs no grouping', async () => {
    for (const fixture of fixtures.filter((f) => f.positive)) {
      const result = await wrapRegions(fixture.input, 'java', 'all', config(), parserManager);
      for (const edit of result.edits) {
        expect(edit.newText).not.toMatch(/^\(/);
      }
    }
  });

  it("eval-equivalence: every positive fixture's wrapped value equals its original value", () => {
    // Java's counterpart to `./python-string-wrap-fixtures.test.ts`'s own
    // eval-equivalence check. No Java toolchain is available in this
    // project's toolchain (nor should one need to be) —
    // `extractConcatenatedStringValue` reimplements just enough of Java's
    // own escape decoding as a test-only oracle; see
    // `../support/decode-java-string.ts` for the full rationale.
    for (const fixture of fixtures.filter((f) => f.positive)) {
      const before = extractConcatenatedStringValue(fixture.input);
      const after = extractConcatenatedStringValue(fixture.expected);
      expect(after).toBe(before);
    }
  });

  it('negative fixtures also round-trip through the decoder unchanged (a sanity check on the oracle itself)', () => {
    for (const fixture of fixtures.filter((f) => !f.positive && f.name !== 'neg-004-text-block')) {
      const before = extractConcatenatedStringValue(fixture.input);
      const after = extractConcatenatedStringValue(fixture.expected);
      expect(after).toBe(before);
    }
  });
});
