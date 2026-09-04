import { beforeAll, describe, expect, it } from 'vitest';
import { createTestParserManager } from '../helpers/create-test-parser-manager.js';
import { applyTextEdits } from '../../src/apply-edits.js';
import { ParserManager } from '../../src/parser/parser-manager.js';
import type { WrapConfig } from '../../src/types/config.js';
import { latexAdapter } from '../../src/languages/latex/adapter.js';
import { wrapRegions } from '../../src/wrap.js';

import reflowBeforeIn from '../fixtures/latex/trailing-comments/001-reflow-before-moves-words.in.tex?raw';
import reflowBeforeOut from '../fixtures/latex/trailing-comments/001-reflow-before-moves-words.out.tex?raw';
import reflowAfterIn from '../fixtures/latex/trailing-comments/002-reflow-after-never-pulls-up.in.tex?raw';
import reflowAfterOut from '../fixtures/latex/trailing-comments/002-reflow-after-never-pulls-up.out.tex?raw';
import escapedPercentIn from '../fixtures/latex/trailing-comments/003-escaped-percent-not-a-comment.in.tex?raw';
import escapedPercentOut from '../fixtures/latex/trailing-comments/003-escaped-percent-not-a-comment.out.tex?raw';
import verbIn from '../fixtures/latex/verb/001-verb-unbreakable.in.tex?raw';
import verbOut from '../fixtures/latex/verb/001-verb-unbreakable.out.tex?raw';
import lstinlineIn from '../fixtures/latex/verb/002-lstinline-unbreakable.in.tex?raw';
import lstinlineOut from '../fixtures/latex/verb/002-lstinline-unbreakable.out.tex?raw';

/**
 * Phase D commit 17: trailing-`%`-comment safety and `\verb`/`\lstinline`
 * unbreakability.
 * Each `.out.tex` was produced by actually running `wrapRegions` against
 * the paired `.in.tex` (not hand-computed), then verified — idempotent,
 * no line over the column limit *except* the two `\verb`/`\lstinline`
 * fixtures, whose whole point is that their unbreakable span survives
 * intact even though it exceeds the limit (the same "overflow rule" a
 * lone long URL already relies on) — before being committed as gold.
 *
 * `verb/002-lstinline-unbreakable` is the fixture that caught a real bug
 * in this commit's own first attempt: two separate `extraUnbreakable`
 * patterns (`\verb`'s and `\lstinline`'s), each with its own `(.)`/`\1`
 * capture-and-backreference, get capture-group-renumbered when
 * `findUnbreakableSpans` combines them into one `RegExp` — `\lstinline`'s
 * own `\1` silently started meaning `\verb`'s group instead, truncating
 * every real `\lstinline|...|` match at its first internal space. Fixed
 * in `../../src/languages/latex/wrap-prose.ts` by merging both commands
 * into one pattern with a single shared capture group; see that file's
 * own doc comment and `../../src/segmentation/unbreakable-spans.ts`'s
 * updated warning for the general shape of this pitfall.
 */
const COLUMN_LIMIT = 40;

interface Fixture {
  readonly name: string;
  readonly input: string;
  readonly expected: string;
}

const fixtures: readonly Fixture[] = [
  { name: 'trailing-comments/001-reflow-before-moves-words', input: reflowBeforeIn, expected: reflowBeforeOut },
  { name: 'trailing-comments/002-reflow-after-never-pulls-up', input: reflowAfterIn, expected: reflowAfterOut },
  {
    name: 'trailing-comments/003-escaped-percent-not-a-comment',
    input: escapedPercentIn,
    expected: escapedPercentOut,
  },
  { name: 'verb/001-verb-unbreakable', input: verbIn, expected: verbOut },
  { name: 'verb/002-lstinline-unbreakable', input: lstinlineIn, expected: lstinlineOut },
];

const NEVER_UNDER_LIMIT = new Set(['verb/001-verb-unbreakable', 'verb/002-lstinline-unbreakable']);

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
  parserManager = await createTestParserManager(latexAdapter);
});

describe('LaTeX trailing-% comment safety and \\verb/\\lstinline unbreakability — end-to-end gold fixtures', () => {
  it.each(fixtures.map((f) => [f.name, f] as const))('%s', async (_name, fixture) => {
    const result = await wrapRegions(fixture.input, 'latex', 'all', config(), parserManager);
    const actual = applyTextEdits(fixture.input, result.edits);
    expect(actual).toBe(fixture.expected);
  });

  it('every fixture actually changes the source', () => {
    for (const fixture of fixtures) {
      expect(fixture.expected).not.toBe(fixture.input);
    }
  });

  it('is idempotent — wrapping already-wrapped output produces zero further edits', async () => {
    for (const fixture of fixtures) {
      const result = await wrapRegions(fixture.expected, 'latex', 'all', config(), parserManager);
      const reapplied = applyTextEdits(fixture.expected, result.edits);
      expect(reapplied).toBe(fixture.expected);
    }
  });

  it('produces no reflowed line over the column limit, except the two deliberately-unbreakable verb/lstinline fixtures', async () => {
    for (const fixture of fixtures) {
      if (NEVER_UNDER_LIMIT.has(fixture.name)) {
        continue;
      }
      const result = await wrapRegions(fixture.input, 'latex', 'all', config(), parserManager);
      const actual = applyTextEdits(fixture.input, result.edits);
      for (const line of actual.split('\n')) {
        expect(line.length).toBeLessThanOrEqual(COLUMN_LIMIT);
      }
    }
  });

  it('the trailing-comment stays glued to its preceding word — never appears alone on its own line', () => {
    const lines = reflowBeforeOut.split('\n');
    expect(lines).toContain('appears % a note here');
  });

  it('never pulls a following line\'s words up onto a comment line, even when there would be room', () => {
    const lines = reflowAfterOut.split('\n');
    // "Short intro % a brief note" is 27 columns — 13 columns of room
    // remain under the 40-column limit, but "This" (the next line's own
    // first word) must never be pulled up onto it.
    expect(lines[0]).toBe('Short intro % a brief note');
    expect(lines[1]!.startsWith('This')).toBe(true);
  });

  it('an escaped \\% reflows as ordinary text; the real % after it stays a protected comment', () => {
    expect(escapedPercentOut).toContain('100\\%');
    // The escaped percent sign survived being reflowed onto a different
    // line than it started on — proof it was treated as ordinary
    // reflowable text, not specially protected or corrupted.
    const lines = escapedPercentOut.split('\n');
    expect(lines.some((line) => line.includes('100\\%'))).toBe(true);
    expect(lines.some((line) => line.includes('% actual comment here'))).toBe(true);
  });

  it('a \\verb span survives whole even though it exceeds the column limit (the overflow rule)', () => {
    const verbLine = verbOut.split('\n').find((line) => line.includes('\\verb'))!;
    expect(verbLine).toBe(
      '\\verb|a very long verbatim content that would otherwise need to wrap|',
    );
    expect(verbLine.length).toBeGreaterThan(COLUMN_LIMIT);
  });

  it('a \\lstinline span survives whole even though it exceeds the column limit — the bug this fixture caught', () => {
    const lstinlineLine = lstinlineOut.split('\n').find((line) => line.includes('\\lstinline'))!;
    expect(lstinlineLine).toBe('\\lstinline|some_function_name(argument_one, argument_two)|');
    expect(lstinlineLine.length).toBeGreaterThan(COLUMN_LIMIT);
  });
});
