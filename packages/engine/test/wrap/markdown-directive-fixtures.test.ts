import { beforeAll, describe, expect, it } from 'vitest';
import { createTestParserManager } from '../helpers/create-test-parser-manager.js';
import { applyTextEdits } from '../../src/apply-edits.js';
import { ParserManager } from '../../src/parser/parser-manager.js';
import type { WrapConfig } from '../../src/types/config.js';
import { markdownAdapter } from '../../src/languages/markdown/adapter.js';
import { wrapRegions } from '../../src/wrap.js';

import offOnIn from '../fixtures/markdown/directives/001-off-on.in.md?raw';
import offOnOut from '../fixtures/markdown/directives/001-off-on.out.md?raw';
import ignoreIn from '../fixtures/markdown/directives/002-ignore.in.md?raw';
import ignoreOut from '../fixtures/markdown/directives/002-ignore.out.md?raw';

/**
 * Directive gold fixtures — Phase C commit 11. No adapter-level code
 * backs this (`../../src/languages/markdown/adapter.ts`'s own doc
 * comment): `markdownDescriptor.directives.marker` (`'<!--'`,
 * `../../src/languages/markdown/descriptor.ts`) is all `wrap.ts` needed,
 * generically, to make `<!-- rewrap: off/on/ignore -->` work — these
 * fixtures are the end-to-end proof of that, alongside `../../src/directives.test.ts`'s
 * own unit-level coverage of the marker itself.
 */
const COLUMN_LIMIT = 60;

interface Fixture {
  readonly name: string;
  readonly input: string;
  readonly expected: string;
}

const fixtures: readonly Fixture[] = [
  { name: '001-off-on', input: offOnIn, expected: offOnOut },
  { name: '002-ignore', input: ignoreIn, expected: ignoreOut },
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

describe('Markdown directives — end-to-end gold fixtures', () => {
  it.each(fixtures.map((f) => [f.name, f] as const))('%s', async (_name, fixture) => {
    const result = await wrapRegions(fixture.input, 'markdown', 'all', config(), parserManager);
    const actual = applyTextEdits(fixture.input, result.edits);
    expect(actual).toBe(fixture.expected);
  });

  it('the off/on fixture skips exactly the one paragraph inside the range, with the right reason', async () => {
    const result = await wrapRegions(offOnIn, 'markdown', 'all', config(), parserManager);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason).toMatch(/rewrap:off\/fmt:off/);
  });

  it('the ignore fixture skips exactly the marked paragraph, with the right reason, and wraps the other', async () => {
    const result = await wrapRegions(ignoreIn, 'markdown', 'all', config(), parserManager);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason).toMatch(/rewrap:ignore/);
    expect(result.edits).toHaveLength(1);
  });

  it('is idempotent: re-wrapping the gold output produces no further edits', async () => {
    for (const fixture of fixtures) {
      const result = await wrapRegions(fixture.expected, 'markdown', 'all', config(), parserManager);
      expect(result.edits).toEqual([]);
    }
  });

  it('produces no reflowed line over the column limit, among the lines actually wrapped', async () => {
    // Scoped to `result.edits[*].newText` (the same scoping
    // `../../src/conformance/run-adapter-conformance.ts`'s own version of
    // this check uses), not the whole reassembled file: both fixtures
    // *deliberately* leave one paragraph untouched at its original,
    // over-limit length (that's what "skipped by a directive" means), so
    // checking the whole file would fail on the very thing these
    // fixtures exist to prove.
    for (const fixture of fixtures) {
      const result = await wrapRegions(fixture.input, 'markdown', 'all', config(), parserManager);
      for (const edit of result.edits) {
        for (const line of edit.newText.split('\n')) {
          expect(line.length).toBeLessThanOrEqual(COLUMN_LIMIT);
        }
      }
    }
  });
});
