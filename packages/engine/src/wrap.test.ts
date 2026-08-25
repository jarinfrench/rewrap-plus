import { beforeAll, describe, expect, it } from 'vitest';
import { AdapterRegistry } from './adapter-registry.js';
import { applyTextEdits } from './apply-edits.js';
import { discoverRegions } from './discovery/discover-regions.js';
import { ParserManager } from './parser/parser-manager.js';
import type { WrapConfig } from './types/config.js';
import { pythonAdapter } from './languages/python/adapter.js';
import { wrapRegions } from './wrap.js';

// See `./parser/parser-manager.test.ts` for why `'.'` is the right
// `wasmDir` under Vitest (cwd is this package's root).
const engineRoot = '.';

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
  const registry = new AdapterRegistry();
  registry.register(pythonAdapter);
  parserManager = await ParserManager.create({ wasmDir: engineRoot, registry });
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
    // second pass should be a pure no-op (idempotency, Phase 10's
    // eventual property test, exercised early here for the one region
    // kind this phase implements).
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

  it('skips a docstring region with a reason naming the missing implementation', async () => {
    const source = '"""A module docstring that is not wrapped by this phase."""\n';
    const result = await wrapRegions(source, 'python', 'all', config(), parserManager);
    expect(result.edits).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.region.kind).toBe('docstring');
    expect(result.skipped[0]!.reason).toMatch(/not implemented/);
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
});
