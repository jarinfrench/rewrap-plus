import { beforeAll, describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../../src/adapter-registry.js';
import { applyTextEdits } from '../../src/apply-edits.js';
import { ParserManager } from '../../src/parser/parser-manager.js';
import type { WrapConfig } from '../../src/types/config.js';
import { markdownAdapter } from '../../src/languages/markdown/adapter.js';
import { wrapRegions } from '../../src/wrap.js';

import twoSpaceIn from '../fixtures/markdown/hard-breaks/001-two-space.in.md?raw';
import twoSpaceOut from '../fixtures/markdown/hard-breaks/001-two-space.out.md?raw';
import backslashIn from '../fixtures/markdown/hard-breaks/002-backslash.in.md?raw';
import backslashOut from '../fixtures/markdown/hard-breaks/002-backslash.out.md?raw';
import brTagIn from '../fixtures/markdown/hard-breaks/003-br-tag.in.md?raw';
import brTagOut from '../fixtures/markdown/hard-breaks/003-br-tag.out.md?raw';
import oddParityIn from '../fixtures/markdown/hard-breaks/004-three-backslashes-odd-parity.in.md?raw';
import oddParityOut from '../fixtures/markdown/hard-breaks/004-three-backslashes-odd-parity.out.md?raw';
import negEscapedIn from '../fixtures/markdown/hard-breaks/neg-001-escaped-backslash-not-a-break.in.md?raw';
import negEscapedOut from '../fixtures/markdown/hard-breaks/neg-001-escaped-backslash-not-a-break.out.md?raw';

/**
 * §5.4 hard-break gold fixtures — `docs/planning/markdown-latex-plan.md`
 * Phase C commit 11. Every source line here is deliberately short enough
 * to fit well within `COLUMN_LIMIT` on its own, so a break surviving into
 * the output can only be the hard-break marker forcing it — reflow would
 * otherwise happily join two such short lines onto one, which is exactly
 * what the negative fixture demonstrates actually happening.
 *
 * `004-three-backslashes-odd-parity` and `neg-001-escaped-backslash-not-a-break`
 * are the direct payoff of `./markdown/hard-break.ts`'s parity fix: the
 * plan's own §5.4 text (`/(?<!\\)\\$/`, a one-character lookbehind) gets
 * two trailing backslashes right (not a break) but silently gets three
 * wrong (also "not a break" under that regex, when CommonMark's real
 * escape-pairing rule says three backslashes *is* one). Phase A's probe
 * found this gap before it shipped (`docs/parsing.md` Finding 7's closing
 * paragraph); these two fixtures are the regression coverage for it, not
 * just the two obvious cases (one backslash, two backslashes) a less
 * careful pass might have stopped at.
 */
const COLUMN_LIMIT = 40;

interface Fixture {
  readonly name: string;
  readonly input: string;
  readonly expected: string;
  readonly positive: boolean;
}

const fixtures: readonly Fixture[] = [
  { name: '001-two-space', input: twoSpaceIn, expected: twoSpaceOut, positive: true },
  { name: '002-backslash', input: backslashIn, expected: backslashOut, positive: true },
  { name: '003-br-tag', input: brTagIn, expected: brTagOut, positive: true },
  {
    name: '004-three-backslashes-odd-parity',
    input: oddParityIn,
    expected: oddParityOut,
    positive: true,
  },
  {
    name: 'neg-001-escaped-backslash-not-a-break',
    input: negEscapedIn,
    expected: negEscapedOut,
    positive: false,
  },
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

const engineRoot = '.';

let parserManager: ParserManager;

beforeAll(async () => {
  const registry = new AdapterRegistry();
  registry.register(markdownAdapter);
  parserManager = await ParserManager.create({ wasmDir: engineRoot, registry });
});

describe('Markdown hard-break wrapping — end-to-end gold fixtures', () => {
  it.each(fixtures.map((f) => [f.name, f] as const))('%s', async (_name, fixture) => {
    const result = await wrapRegions(fixture.input, 'markdown', 'all', config(), parserManager);
    const actual = applyTextEdits(fixture.input, result.edits);
    expect(actual).toBe(fixture.expected);
  });

  it('every positive fixture keeps its two physical lines separate in the output', () => {
    for (const fixture of fixtures.filter((f) => f.positive)) {
      const lines = fixture.expected.trimEnd().split('\n');
      expect(lines.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('the negative fixture joins its two physical lines onto one (no hard break forced)', () => {
    const negative = fixtures.find((f) => f.name === 'neg-001-escaped-backslash-not-a-break')!;
    const lines = negative.expected.trimEnd().split('\n');
    expect(lines).toHaveLength(1);
  });

  it('preserves every backslash byte-for-byte across the wrap, for both the odd- and even-parity fixtures', () => {
    const countBackslashes = (s: string): number => [...s].filter((ch) => ch === '\\').length;
    for (const fixture of [
      fixtures.find((f) => f.name === '002-backslash')!,
      fixtures.find((f) => f.name === '004-three-backslashes-odd-parity')!,
      fixtures.find((f) => f.name === 'neg-001-escaped-backslash-not-a-break')!,
    ]) {
      expect(countBackslashes(fixture.expected)).toBe(countBackslashes(fixture.input));
    }
  });

  it('is idempotent: re-wrapping the gold output produces no further edits', async () => {
    for (const fixture of fixtures) {
      const result = await wrapRegions(fixture.expected, 'markdown', 'all', config(), parserManager);
      expect(result.edits).toEqual([]);
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

  it('the two-space hard break is the only fixture whose output carries trailing whitespace', () => {
    // The one legitimate trailing whitespace in this whole project
    // (`docs/adapters.md`/`../../src/conformance/run-adapter-conformance.ts`'s
    // own documented carve-out) — confirmed here to be exactly this one
    // fixture, not a side effect leaking into any other.
    for (const fixture of fixtures) {
      const hasTrailingWhitespace = fixture.expected
        .split('\n')
        .some((line) => /[ \t]$/.test(line));
      expect(hasTrailingWhitespace).toBe(fixture.name === '001-two-space');
    }
  });
});
