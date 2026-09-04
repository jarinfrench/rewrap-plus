import { beforeAll, describe, expect, it } from 'vitest';
import { createTestParserManager } from '../helpers/create-test-parser-manager.js';
import { applyTextEdits } from '../../src/apply-edits.js';
import { ParserManager } from '../../src/parser/parser-manager.js';
import type { WrapConfig } from '../../src/types/config.js';
import { markdownAdapter } from '../../src/languages/markdown/adapter.js';
import { wrapRegions } from '../../src/wrap.js';

import longLineIn from '../fixtures/markdown/paragraphs/001-long-line.in.md?raw';
import longLineOut from '../fixtures/markdown/paragraphs/001-long-line.out.md?raw';
import shortLinesIn from '../fixtures/markdown/paragraphs/002-short-lines-joined.in.md?raw';
import shortLinesOut from '../fixtures/markdown/paragraphs/002-short-lines-joined.out.md?raw';
import blankSeparatedIn from '../fixtures/markdown/paragraphs/003-blank-line-separated.in.md?raw';
import blankSeparatedOut from '../fixtures/markdown/paragraphs/003-blank-line-separated.out.md?raw';
import alreadyWrappedIn from '../fixtures/markdown/paragraphs/004-already-correctly-wrapped-byte-identical.in.md?raw';
import alreadyWrappedOut from '../fixtures/markdown/paragraphs/004-already-correctly-wrapped-byte-identical.out.md?raw';
import unorderedIn from '../fixtures/markdown/lists/001-unordered.in.md?raw';
import unorderedOut from '../fixtures/markdown/lists/001-unordered.out.md?raw';
import orderedIn from '../fixtures/markdown/lists/002-ordered.in.md?raw';
import orderedOut from '../fixtures/markdown/lists/002-ordered.out.md?raw';
import taskIn from '../fixtures/markdown/lists/003-task.in.md?raw';
import taskOut from '../fixtures/markdown/lists/003-task.out.md?raw';
import singleQuoteIn from '../fixtures/markdown/blockquotes/001-single-line-quote.in.md?raw';
import singleQuoteOut from '../fixtures/markdown/blockquotes/001-single-line-quote.out.md?raw';
import nestedQuoteIn from '../fixtures/markdown/blockquotes/002-nested-quote.in.md?raw';
import nestedQuoteOut from '../fixtures/markdown/blockquotes/002-nested-quote.out.md?raw';
import lazyContinuationIn from '../fixtures/markdown/blockquotes/003-lazy-continuation-gains-marker.in.md?raw';
import lazyContinuationOut from '../fixtures/markdown/blockquotes/003-lazy-continuation-gains-marker.out.md?raw';
import quoteInListIn from '../fixtures/markdown/blockquotes/004-quote-in-list.in.md?raw';
import quoteInListOut from '../fixtures/markdown/blockquotes/004-quote-in-list.out.md?raw';
import listInQuoteIn from '../fixtures/markdown/blockquotes/005-list-in-quote.in.md?raw';
import listInQuoteOut from '../fixtures/markdown/blockquotes/005-list-in-quote.out.md?raw';

/**
 * The Markdown adapter's first real wrapping gold fixtures — Phase C
 * commit 10. Each `.out.md`
 * was produced by actually running this adapter's own `wrapRegions`
 * pipeline against the paired `.in.md` (not hand-computed), then verified
 * — idempotent, every line within `COLUMN_LIMIT`, no skipped regions —
 * before being committed as the gold file; this suite re-asserts all of
 * that on every run so a future regression is caught the same way a
 * hand-written expectation would catch it.
 *
 * `003-lazy-continuation-gains-marker` is the one fixture whose `.in.md`
 * doesn't already look like its `.out.md`: the source's second line has
 * no `>` at all (a lazy continuation, legal CommonMark), and the gold
 * output shows it gaining one — §3.3 item 1's "continuation prefix is
 * canonical, not observed" made concrete.
 *
 * No hard-break fixtures here — `wrapMarkdownProse` doesn't support them
 * yet (`../../src/languages/markdown/wrap-prose.ts`'s own doc comment;
 * Phase C commit 11).
 */
const COLUMN_LIMIT = 40;

interface Fixture {
  readonly name: string;
  readonly input: string;
  readonly expected: string;
}

const fixtures: readonly Fixture[] = [
  { name: 'paragraphs/001-long-line', input: longLineIn, expected: longLineOut },
  { name: 'paragraphs/002-short-lines-joined', input: shortLinesIn, expected: shortLinesOut },
  { name: 'paragraphs/003-blank-line-separated', input: blankSeparatedIn, expected: blankSeparatedOut },
  {
    name: 'paragraphs/004-already-correctly-wrapped-byte-identical',
    input: alreadyWrappedIn,
    expected: alreadyWrappedOut,
  },
  { name: 'lists/001-unordered', input: unorderedIn, expected: unorderedOut },
  { name: 'lists/002-ordered', input: orderedIn, expected: orderedOut },
  { name: 'lists/003-task', input: taskIn, expected: taskOut },
  { name: 'blockquotes/001-single-line-quote', input: singleQuoteIn, expected: singleQuoteOut },
  { name: 'blockquotes/002-nested-quote', input: nestedQuoteIn, expected: nestedQuoteOut },
  {
    name: 'blockquotes/003-lazy-continuation-gains-marker',
    input: lazyContinuationIn,
    expected: lazyContinuationOut,
  },
  { name: 'blockquotes/004-quote-in-list', input: quoteInListIn, expected: quoteInListOut },
  { name: 'blockquotes/005-list-in-quote', input: listInQuoteIn, expected: listInQuoteOut },
];

function config(overrides: Partial<WrapConfig> = {}): WrapConfig {
  return {
    columnLimit: COLUMN_LIMIT,
    tabSize: 4,
    wrapComments: true,
    wrapStrings: true,
    stringPolicy: 'all',
    docDialect: 'auto',
    preserveIndentedBlocks: false,
    balancedWrapping: false,
    ...overrides,
  };
}

let parserManager: ParserManager;

beforeAll(async () => {
  parserManager = await createTestParserManager(markdownAdapter);
});

describe('Markdown prose wrapping — end-to-end gold fixtures', () => {
  it.each(fixtures.map((f) => [f.name, f] as const))('%s', async (_name, fixture) => {
    const result = await wrapRegions(fixture.input, 'markdown', 'all', config(), parserManager);
    const actual = applyTextEdits(fixture.input, result.edits);
    expect(actual).toBe(fixture.expected);
  });

  it('the lazy-continuation fixture actually gains a "> " it did not have in source (a real change, not byte-identical)', () => {
    expect(lazyContinuationOut).not.toBe(lazyContinuationIn);
    expect(lazyContinuationIn.split('\n')[1]?.startsWith('>')).toBe(false);
    expect(lazyContinuationOut.split('\n').slice(1, -1).every((line) => line.startsWith('>'))).toBe(
      true,
    );
  });

  it('every fixture actually changes the source, except the already-wrapped one', () => {
    for (const fixture of fixtures) {
      if (fixture.name === 'paragraphs/004-already-correctly-wrapped-byte-identical') {
        expect(fixture.expected).toBe(fixture.input);
        continue;
      }
      expect(fixture.expected).not.toBe(fixture.input);
    }
  });

  it('produces no reflowed line over the column limit for any fixture', async () => {
    for (const fixture of fixtures) {
      const result = await wrapRegions(fixture.input, 'markdown', 'all', config(), parserManager);
      const actual = applyTextEdits(fixture.input, result.edits);
      for (const line of actual.split('\n')) {
        expect(line.length).toBeLessThanOrEqual(COLUMN_LIMIT);
      }
    }
  });

  it('is idempotent: re-wrapping the gold output produces no further edits', async () => {
    for (const fixture of fixtures) {
      const result = await wrapRegions(fixture.expected, 'markdown', 'all', config(), parserManager);
      expect(result.edits).toEqual([]);
    }
  });

  it('never skips a region for any fixture (every paragraph here is expected to wrap)', async () => {
    for (const fixture of fixtures) {
      const result = await wrapRegions(fixture.input, 'markdown', 'all', config(), parserManager);
      expect(result.skipped).toEqual([]);
    }
  });

  it('applies the correct canonical continuation prefix for every container shape', () => {
    const expectedPrefixByFixture: Record<string, string> = {
      'lists/001-unordered': '  ',
      'lists/002-ordered': '   ',
      'lists/003-task': '      ',
      'blockquotes/001-single-line-quote': '> ',
      'blockquotes/002-nested-quote': '>> ',
      'blockquotes/004-quote-in-list': '  > ',
      'blockquotes/005-list-in-quote': '>   ',
    };
    for (const [name, prefix] of Object.entries(expectedPrefixByFixture)) {
      const fixture = fixtures.find((f) => f.name === name)!;
      const continuationLines = fixture.expected.split('\n').slice(1, -1);
      expect(continuationLines.length).toBeGreaterThan(0);
      for (const line of continuationLines) {
        expect(line.startsWith(prefix)).toBe(true);
      }
    }
  });
});
