import { describe, expect, it } from 'vitest';
import type { Block } from '../../src/types/document.js';
import type { SplitBlocksOptions } from '../../src/segmentation/split-blocks.js';
import { splitBlocks } from '../../src/segmentation/split-blocks.js';

import paragraphsSource from '../fixtures/blocks/001-paragraphs.txt?raw';
import paragraphsExpected from '../fixtures/blocks/001-paragraphs.expected.json';
import listItemsSource from '../fixtures/blocks/002-list-items.txt?raw';
import listItemsExpected from '../fixtures/blocks/002-list-items.expected.json';
import fencedCodeSource from '../fixtures/blocks/003-fenced-code.txt?raw';
import fencedCodeExpected from '../fixtures/blocks/003-fenced-code.expected.json';
import doctestSource from '../fixtures/blocks/004-doctest.txt?raw';
import doctestExpected from '../fixtures/blocks/004-doctest.expected.json';
import markdownTableSource from '../fixtures/blocks/005-markdown-table.txt?raw';
import markdownTableExpected from '../fixtures/blocks/005-markdown-table.expected.json';
import restLiteralBlockSource from '../fixtures/blocks/006-rest-literal-block.txt?raw';
import restLiteralBlockExpected from '../fixtures/blocks/006-rest-literal-block.expected.json';
import mixedDocumentSource from '../fixtures/blocks/007-mixed-document.txt?raw';
import mixedDocumentExpected from '../fixtures/blocks/007-mixed-document.expected.json';
import preserveIndentedBlocksSource from '../fixtures/blocks/008-preserve-indented-blocks.txt?raw';
import preserveIndentedBlocksExpected from '../fixtures/blocks/008-preserve-indented-blocks.expected.json';

/**
 * Phase 4's stated acceptance criterion: "Blocks round-trip: a document
 * with no over-limit lines produces identical output through
 * segment → reflow → emit." Reflow and emit don't exist until Phase 5
 * and Phase 6+ respectively, so the executable half of that acceptance
 * criterion available *today* is the segment step alone: every fixture's
 * `Block[]` matches a checked-in gold file exactly, byte for byte —
 * meaning every word from the source landed in exactly one atom, every
 * verbatim region kept its original lines untouched, and nothing was
 * silently dropped or duplicated. That's what a future reflow/emit pass
 * would need to be true of *its* input for the full round-trip to hold.
 *
 * Follows this project's established fixture-testing convention (see
 * `../discovery/python-region-fixtures.test.ts`): fixtures imported
 * statically so a missing or misnamed `.expected.json` is a compile-time
 * import error, not a silently-skipped test.
 */
interface Fixture {
  readonly name: string;
  readonly source: string;
  readonly expected: readonly Block[];
  readonly options?: SplitBlocksOptions;
}

const fixtures: readonly Fixture[] = [
  { name: '001-paragraphs', source: paragraphsSource, expected: paragraphsExpected as Block[] },
  { name: '002-list-items', source: listItemsSource, expected: listItemsExpected as Block[] },
  { name: '003-fenced-code', source: fencedCodeSource, expected: fencedCodeExpected as Block[] },
  { name: '004-doctest', source: doctestSource, expected: doctestExpected as Block[] },
  {
    name: '005-markdown-table',
    source: markdownTableSource,
    expected: markdownTableExpected as Block[],
  },
  {
    name: '006-rest-literal-block',
    source: restLiteralBlockSource,
    expected: restLiteralBlockExpected as Block[],
  },
  {
    name: '007-mixed-document',
    source: mixedDocumentSource,
    expected: mixedDocumentExpected as Block[],
  },
  {
    name: '008-preserve-indented-blocks',
    source: preserveIndentedBlocksSource,
    expected: preserveIndentedBlocksExpected as Block[],
    options: { preserveIndentedBlocks: true },
  },
];

describe('splitBlocks fixtures', () => {
  it.each(fixtures.map((f) => [f.name, f] as const))('%s', (_name, fixture) => {
    const actual = splitBlocks(fixture.source, fixture.options ?? {});
    expect(actual).toEqual(fixture.expected);
  });

  it('covers the cases the plan calls out for this phase', () => {
    // Not a behavioral assertion — a guard against silently losing
    // coverage of one of the block kinds this phase introduces (plain
    // paragraphs, list items with hanging indent, fenced code, doctests,
    // Markdown tables, `::`-triggered reST literal blocks, a mixed
    // document exercising all of them together, and the
    // `preserveIndentedBlocks` option) if a fixture were ever renamed or
    // removed without a replacement.
    expect(fixtures.map((f) => f.name)).toEqual([
      '001-paragraphs',
      '002-list-items',
      '003-fenced-code',
      '004-doctest',
      '005-markdown-table',
      '006-rest-literal-block',
      '007-mixed-document',
      '008-preserve-indented-blocks',
    ]);
  });

  it('re-splitting a fixture is idempotent', () => {
    // A weak preview of Phase 10's blocking idempotency property test:
    // splitBlocks has no reason to behave differently given its own
    // output's *shape* fed back through — verbatim `lines` and paragraph/
    // listItem `atoms` re-tokenize identically to themselves. Real
    // idempotency (through reflow/emit) is Phase 10's job.
    for (const fixture of fixtures) {
      const once = splitBlocks(fixture.source, fixture.options ?? {});
      const twice = splitBlocks(fixture.source, fixture.options ?? {});
      expect(twice).toEqual(once);
    }
  });
});
