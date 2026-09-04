import { beforeAll, describe, expect, it } from 'vitest';
import { createTestParserManager } from '../test/helpers/create-test-parser-manager.js';
import { applyTextEdits } from './apply-edits.js';
import { discoverRegions } from './discovery/discover-regions.js';
import { ParserManager } from './parser/parser-manager.js';
import type { WrapConfig } from './types/config.js';
import { pythonAdapter } from './languages/python/adapter.js';
import { wrapRegions } from './wrap.js';

function config(overrides: Partial<WrapConfig> = {}): WrapConfig {
  return {
    columnLimit: 40,
    tabSize: 4,
    wrapComments: true,
    wrapStrings: false,
    stringPolicy: 'off',
    docDialect: 'plain',
    preserveIndentedBlocks: false,
    balancedWrapping: false,
    ...overrides,
  };
}

let parserManager: ParserManager;

beforeAll(async () => {
  parserManager = await createTestParserManager(pythonAdapter);
});

describe('wrapRegions', () => {
  it('rejects a language other than python', async () => {
    await expect(
      wrapRegions('x = 1\n', 'javascript', 'all', config(), parserManager),
    ).rejects.toThrow(/javascript/);
  });

  it('produces no edits and no skips for a file with no wrappable regions', async () => {
    const result = await wrapRegions('x = 1\n', 'python', 'all', config(), parserManager);
    expect(result.edits).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it('wraps a long comment and the applied edit fits the column limit', async () => {
    const source = '# ' + 'word '.repeat(20).trim() + '\nx = 1\n';
    const result = await wrapRegions(
      source,
      'python',
      'all',
      config({ columnLimit: 20 }),
      parserManager,
    );

    expect(result.edits).toHaveLength(1);
    const wrapped = applyTextEdits(source, result.edits);
    for (const line of wrapped.split('\n')) {
      if (line.startsWith('#')) {
        expect(line.length).toBeLessThanOrEqual(20);
      }
    }
  });

  it('threads balancedWrapping through to the reflow algorithm', async () => {
    // Same word set as reflow-block.test.ts's "finds a strictly
    // lower-cost partition than greedy when one exists" — a case known
    // to produce genuinely different line breaks between the two modes
    // (not just a tie), reused here so this test is checking that
    // WrapConfig.balancedWrapping actually reaches reflowBlock through
    // wrapRegions -> emitLineComments, not re-deriving its own
    // differing example.
    const source = '# aaaaaa b ccccc ddddddd eeeeeee\nx = 1\n';
    const cfg = config({ columnLimit: 12 }); // '# ' overhead (2) + width 10, matching that test's width

    const greedy = await wrapRegions(source, 'python', 'all', cfg, parserManager);
    const balanced = await wrapRegions(
      source,
      'python',
      'all',
      { ...cfg, balancedWrapping: true },
      parserManager,
    );

    expect(greedy.edits).toHaveLength(1);
    expect(balanced.edits).toHaveLength(1);
    expect(greedy.edits[0]!.newText).not.toBe(balanced.edits[0]!.newText);
  });

  it('produces no edit for a comment already correctly wrapped at the configured width', async () => {
    // Wrap once to get a known-good wrapping, then wrap again — the
    // second pass should be a pure no-op (idempotency, exercised early
    // here for line comments, ahead of the round-trip property test
    // that covers every region kind).
    const source = '# ' + 'word '.repeat(20).trim() + '\n';
    const cfg = config({ columnLimit: 20 });
    const first = await wrapRegions(source, 'python', 'all', cfg, parserManager);
    const wrapped = applyTextEdits(source, first.edits);

    const second = await wrapRegions(wrapped, 'python', 'all', cfg, parserManager);
    expect(second.edits).toEqual([]);
  });

  it('skips a region when wrapComments is false', async () => {
    const source = '# a comment\n';
    const result = await wrapRegions(
      source,
      'python',
      'all',
      config({ wrapComments: false }),
      parserManager,
    );
    expect(result.edits).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason).toMatch(/wrapComments/);
  });

  it('wraps a docstring region rather than skipping it', async () => {
    const source = '"""A module docstring that is too long to fit on one line."""\n';
    const result = await wrapRegions(source, 'python', 'all', config(), parserManager);
    expect(result.skipped).toEqual([]);
    expect(result.edits).toHaveLength(1);
    const wrapped = applyTextEdits(source, result.edits);
    for (const line of wrapped.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(40);
    }
  });

  it('skips a stringLiteral region when wrapStrings is false (the default)', async () => {
    const source = 'x = "a plain string literal, not a docstring, well over the column limit"\n';
    const result = await wrapRegions(source, 'python', 'all', config(), parserManager);
    expect(result.edits).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.region.kind).toBe('stringLiteral');
    expect(result.skipped[0]!.reason).toMatch(/wrapStrings/);
  });

  it('wraps a stringLiteral region rather than skipping it, once enabled', async () => {
    const source = 'x = "a plain string literal, not a docstring, well over the column limit"\n';
    const result = await wrapRegions(
      source,
      'python',
      'all',
      config({ wrapStrings: true, stringPolicy: 'all' }),
      parserManager,
    );
    expect(result.skipped).toEqual([]);
    expect(result.edits).toHaveLength(1);
    const wrapped = applyTextEdits(source, result.edits);
    for (const line of wrapped.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(40);
    }
  });

  it('skips a region disabled by a rewrap:off .. on directive range', async () => {
    const source =
      '# rewrap: off\n' + '# ' + 'word '.repeat(20).trim() + '\n' + '# rewrap: on\n';
    const result = await wrapRegions(source, 'python', 'all', config(), parserManager);
    expect(result.edits).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason).toMatch(/rewrap:off/);
  });

  it('skips a region disabled by a fmt:off .. on directive range', async () => {
    const source = '# fmt: off\n' + '# ' + 'word '.repeat(20).trim() + '\n' + '# fmt: on\n';
    const result = await wrapRegions(source, 'python', 'all', config(), parserManager);
    expect(result.edits).toEqual([]);
    expect(result.skipped).toHaveLength(1);
  });

  it('skips a region immediately preceded by a rewrap:ignore directive', async () => {
    // A target on its own statement (a string literal), not another
    // comment line — an ignore directive followed by *another* `#`
    // comment at the same indent would instead merge with it into one
    // region (consecutive-comment grouping), which is a different,
    // already-covered interaction, not what this test means to isolate.
    const source =
      '# rewrap: ignore\n' +
      'x = "' +
      'word '.repeat(20).trim() +
      '"\n';
    const result = await wrapRegions(
      source,
      'python',
      'all',
      config({ wrapStrings: true, stringPolicy: 'all' }),
      parserManager,
    );
    expect(result.edits).toEqual([]);
    expect(result.skipped.some((s) => s.reason.includes('rewrap:ignore'))).toBe(true);
  });

  it('a rewrap:force directive bypasses the prose heuristic for that string', async () => {
    // An identifier-shaped key with no spaces scores well below the
    // eligibility threshold under stringPolicy 'prose' on its own.
    const source = 'x = "some_identifier_shaped_key_without_any_spaces_at_all"  # rewrap: force\n';
    const withoutForce = await wrapRegions(
      source.replace('  # rewrap: force', ''),
      'python',
      'all',
      config({ wrapStrings: true, stringPolicy: 'prose' }),
      parserManager,
    );
    expect(withoutForce.edits).toEqual([]);

    const withForce = await wrapRegions(
      source,
      'python',
      'all',
      config({ wrapStrings: true, stringPolicy: 'prose' }),
      parserManager,
    );
    expect(withForce.edits).toHaveLength(1);
  });

  it('skips a region overlapping a parse error rather than throwing', async () => {
    const source = '# a fine comment\ndef broken(:\n    pass\n';
    const result = await wrapRegions(
      source,
      'python',
      'all',
      config({ columnLimit: 5 }),
      parserManager,
    );
    // The comment region itself doesn't overlap the syntax error, so it
    // should still wrap normally rather than the whole call failing.
    expect(result.edits.length + result.skipped.length).toBeGreaterThan(0);
  });

  it('only wraps regions overlapping the given targets', async () => {
    const source =
      '# first comment that is quite long indeed\n' + 'x = 1\n' + '# second comment also long\n';
    const tree = (await parserManager.parserFor('python')).parse(source)!;
    const allRegions = discoverRegions(pythonAdapter, tree, source, 'python');
    expect(allRegions).toHaveLength(2);

    const result = await wrapRegions(
      source,
      'python',
      [allRegions[0]!.span],
      config({ columnLimit: 15 }),
      parserManager,
    );
    expect(result.edits).toHaveLength(1);
    expect(result.edits[0]!.span.startRow).toBe(allRegions[0]!.span.startRow);
  });

  it('reports cancelled: false when no cancellation signal is given', async () => {
    const result = await wrapRegions('# a comment\n', 'python', 'all', config(), parserManager);
    expect(result.cancelled).toBe(false);
  });

  it('reports cancelled: false when a signal is given but never requests cancellation', async () => {
    const result = await wrapRegions(
      '# a comment\n',
      'python',
      'all',
      config(),
      parserManager,
      { isCancellationRequested: false },
    );
    expect(result.cancelled).toBe(false);
  });

  it('stops processing further regions and reports cancelled: true once the signal fires', async () => {
    const source =
      '# first comment that is quite long indeed\n' +
      'x = 1\n' +
      '# second comment also long indeed\n' +
      'y = 1\n' +
      '# third comment also long indeed\n';

    // A signal already cancelled before the call starts is the simplest
    // deterministic way to prove *no* region past the check gets
    // processed — this doesn't depend on timing or region count.
    const result = await wrapRegions(
      source,
      'python',
      'all',
      config({ columnLimit: 15 }),
      parserManager,
      { isCancellationRequested: true },
    );

    expect(result.cancelled).toBe(true);
    expect(result.edits).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it('keeps whatever was processed before a cancellation that fires partway through', async () => {
    const source =
      '# first comment that is quite long indeed\n' +
      'x = 1\n' +
      '# second comment also long indeed\n' +
      'y = 1\n' +
      '# third comment also long indeed\n';

    // A getter with a side effect: cancellation fires only once the
    // check has already been read once (i.e. after the first region was
    // processed), proving the loop checks the signal *per region*
    // rather than only once up front, and that whatever was already
    // processed survives in the result rather than being discarded.
    let reads = 0;
    const signal = {
      get isCancellationRequested() {
        reads += 1;
        return reads > 1;
      },
    };

    const result = await wrapRegions(
      source,
      'python',
      'all',
      config({ columnLimit: 15 }),
      parserManager,
      signal,
    );

    expect(result.cancelled).toBe(true);
    expect(result.edits).toHaveLength(1);
    expect(result.edits[0]!.span.startRow).toBe(0);
  });
});
