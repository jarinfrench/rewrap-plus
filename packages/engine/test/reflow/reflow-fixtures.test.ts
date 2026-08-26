import { describe, expect, it } from 'vitest';
import { splitBlocks } from '../../src/segmentation/split-blocks.js';
import { reflowBlock } from '../../src/reflow/reflow-block.js';

import longUrlAloneSource from '../fixtures/reflow/001-long-url-alone.txt?raw';
import longUrlAloneExpected from '../fixtures/reflow/001-long-url-alone.json';
import longUrlMidParagraphSource from '../fixtures/reflow/002-long-url-mid-paragraph.txt?raw';
import longUrlMidParagraphExpected from '../fixtures/reflow/002-long-url-mid-paragraph.json';
import atomExactlyAtLimitSource from '../fixtures/reflow/003-atom-exactly-at-limit.txt?raw';
import atomExactlyAtLimitExpected from '../fixtures/reflow/003-atom-exactly-at-limit.json';
import atomAtLimitPlusOneSource from '../fixtures/reflow/004-atom-at-limit-plus-one.txt?raw';
import atomAtLimitPlusOneExpected from '../fixtures/reflow/004-atom-at-limit-plus-one.json';
import hangingIndentCrampedSource from '../fixtures/reflow/005-hanging-indent-cramped.txt?raw';
import hangingIndentCrampedExpected from '../fixtures/reflow/005-hanging-indent-cramped.json';
import cjkTextSource from '../fixtures/reflow/006-cjk-text.txt?raw';
import cjkTextExpected from '../fixtures/reflow/006-cjk-text.json';
import zeroWidthLimitSource from '../fixtures/reflow/007-zero-width-limit.txt?raw';
import zeroWidthLimitExpected from '../fixtures/reflow/007-zero-width-limit.json';

/**
 * The acceptance criterion this suite exists to check: gold fixtures
 * for reflow pass; no output line exceeds the limit unless it is a
 * single unbreakable atom. These fixtures are exactly the edge cases
 * that reflow testing needs to cover ("add reflow tests including
 * overflow and width edge cases"): a long URL alone; a long URL
 * mid-paragraph; an atom exactly at the limit; an atom at limit+1;
 * hanging indent leaving fewer than 10 columns; CJK text; and a
 * zero-width limit guard.
 *
 * Each fixture pairs a plain-prose `.txt` source (run through
 * `splitBlocks` to get a real, single `paragraph` block —
 * exercising the actual segment → reflow pipeline rather than
 * hand-built `Atom` arrays) with a `.json` file carrying the reflow
 * parameters and the expected output lines. Follows this project's
 * established fixture-testing convention (see
 * `../discovery/python-region-fixtures.test.ts`,
 * `../segmentation/split-blocks-fixtures.test.ts`): imported
 * statically so a missing or misnamed fixture file is a compile-time
 * import error, not a silently-skipped test.
 */
interface ReflowFixtureConfig {
  readonly availableWidth: number;
  readonly hangingIndent: number;
  readonly mode?: 'greedy' | 'balanced';
  readonly expected: readonly string[];
}

interface Fixture {
  readonly name: string;
  readonly source: string;
  readonly config: ReflowFixtureConfig;
}

const fixtures: readonly Fixture[] = [
  {
    name: '001-long-url-alone',
    source: longUrlAloneSource,
    config: longUrlAloneExpected as ReflowFixtureConfig,
  },
  {
    name: '002-long-url-mid-paragraph',
    source: longUrlMidParagraphSource,
    config: longUrlMidParagraphExpected as ReflowFixtureConfig,
  },
  {
    name: '003-atom-exactly-at-limit',
    source: atomExactlyAtLimitSource,
    config: atomExactlyAtLimitExpected as ReflowFixtureConfig,
  },
  {
    name: '004-atom-at-limit-plus-one',
    source: atomAtLimitPlusOneSource,
    config: atomAtLimitPlusOneExpected as ReflowFixtureConfig,
  },
  {
    name: '005-hanging-indent-cramped',
    source: hangingIndentCrampedSource,
    config: hangingIndentCrampedExpected as ReflowFixtureConfig,
  },
  {
    name: '006-cjk-text',
    source: cjkTextSource,
    config: cjkTextExpected as ReflowFixtureConfig,
  },
  {
    name: '007-zero-width-limit',
    source: zeroWidthLimitSource,
    config: zeroWidthLimitExpected as ReflowFixtureConfig,
  },
];

describe('reflowBlock fixtures', () => {
  it.each(fixtures.map((f) => [f.name, f] as const))('%s', (_name, fixture) => {
    const [block] = splitBlocks(fixture.source);
    if (!block) {
      throw new Error(`fixture ${fixture.name} produced no blocks`);
    }
    const options = fixture.config.mode ? { mode: fixture.config.mode } : undefined;
    const actual = reflowBlock(
      block,
      fixture.config.availableWidth,
      fixture.config.hangingIndent,
      options,
    );
    expect(actual).toEqual(fixture.config.expected);
  });

  it('covers the overflow/width edge cases reflow is meant to handle', () => {
    // Not a behavioral assertion — a guard against silently losing
    // coverage of one of these named cases if a fixture were ever
    // renamed or removed without a replacement.
    expect(fixtures.map((f) => f.name)).toEqual([
      '001-long-url-alone',
      '002-long-url-mid-paragraph',
      '003-atom-exactly-at-limit',
      '004-atom-at-limit-plus-one',
      '005-hanging-indent-cramped',
      '006-cjk-text',
      '007-zero-width-limit',
    ]);
  });

  it('never produces a line exceeding the limit, except a single unbreakable atom', () => {
    for (const fixture of fixtures) {
      const [block] = splitBlocks(fixture.source);
      if (!block || (block.type !== 'paragraph' && block.type !== 'listItem')) {
        continue;
      }
      const options = fixture.config.mode ? { mode: fixture.config.mode } : undefined;
      const lines = reflowBlock(
        block,
        fixture.config.availableWidth,
        fixture.config.hangingIndent,
        options,
      );
      for (const [i, line] of lines.entries()) {
        const indent = i === 0 ? 0 : fixture.config.hangingIndent;
        const budget =
          i === 0
            ? fixture.config.availableWidth
            : fixture.config.availableWidth - fixture.config.hangingIndent;
        const contentLength = line.length - indent;
        if (contentLength > budget) {
          // Only legitimate if this line is a single atom (no interior
          // space outside the indent — i.e. no unglued join point).
          expect(line.slice(indent)).not.toMatch(/ /);
        }
      }
    }
  });

  it('re-reflowing a fixture with the same parameters is idempotent', () => {
    for (const fixture of fixtures) {
      const [block] = splitBlocks(fixture.source);
      if (!block) continue;
      const options = fixture.config.mode ? { mode: fixture.config.mode } : undefined;
      const once = reflowBlock(
        block,
        fixture.config.availableWidth,
        fixture.config.hangingIndent,
        options,
      );
      const twice = reflowBlock(
        block,
        fixture.config.availableWidth,
        fixture.config.hangingIndent,
        options,
      );
      expect(twice).toEqual(once);
    }
  });
});
