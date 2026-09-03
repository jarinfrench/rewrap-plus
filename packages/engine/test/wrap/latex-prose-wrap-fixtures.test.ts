import { beforeAll, describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../../src/adapter-registry.js';
import { applyTextEdits } from '../../src/apply-edits.js';
import { ParserManager } from '../../src/parser/parser-manager.js';
import type { WrapConfig } from '../../src/types/config.js';
import { latexAdapter } from '../../src/languages/latex/adapter.js';
import { wrapRegions } from '../../src/wrap.js';

import longLineIn from '../fixtures/latex/prose/001-long-line.in.tex?raw';
import longLineOut from '../fixtures/latex/prose/001-long-line.out.tex?raw';
import shortLinesIn from '../fixtures/latex/prose/002-short-lines-joined.in.tex?raw';
import shortLinesOut from '../fixtures/latex/prose/002-short-lines-joined.out.tex?raw';
import alreadyWrappedIn from '../fixtures/latex/prose/003-already-wrapped-byte-identical.in.tex?raw';
import alreadyWrappedOut from '../fixtures/latex/prose/003-already-wrapped-byte-identical.out.tex?raw';
import sectionBodyCommentIn from '../fixtures/latex/prose/004-section-body-and-comment.in.tex?raw';
import sectionBodyCommentOut from '../fixtures/latex/prose/004-section-body-and-comment.out.tex?raw';
import itemIndentationIn from '../fixtures/latex/lists/001-item-indentation.in.tex?raw';
import itemIndentationOut from '../fixtures/latex/lists/001-item-indentation.out.tex?raw';
import doubleBackslashIn from '../fixtures/latex/hard-breaks/001-double-backslash.in.tex?raw';
import doubleBackslashOut from '../fixtures/latex/hard-breaks/001-double-backslash.out.tex?raw';
import newlineCommandIn from '../fixtures/latex/hard-breaks/002-newline-command.in.tex?raw';
import newlineCommandOut from '../fixtures/latex/hard-breaks/002-newline-command.out.tex?raw';

/**
 * The LaTeX adapter's first real *prose* gold fixtures —
 * `docs/planning/markdown-latex-plan.md` Phase D commit 16: `wrapProse`
 * (`../../src/languages/latex/wrap-prose.ts`) dissolving/reflowing/
 * emitting `'prose'` regions through the shared `prose/` pipeline, with
 * LaTeX's own hard-break commands and `\item` indentation. Each `.out.tex`
 * was produced by actually running this adapter's own `wrapRegions`
 * pipeline against the paired `.in.tex` (not hand-computed), then verified
 * — idempotent, no line over the column limit — before being committed as
 * the gold file.
 *
 * `\verb`/`\lstinline` unbreakability and trailing-`%`-comment safety
 * (§6.4/§4.3) are deliberately not exercised here — the plan assigns both
 * to commit 17, and `wrapLatexProse`'s own `ProseSpec` doesn't set
 * `extraUnbreakable` yet (`../../src/languages/latex/wrap-prose.ts`'s own
 * doc comment).
 */
const COLUMN_LIMIT = 40;

interface Fixture {
  readonly name: string;
  readonly input: string;
  readonly expected: string;
}

const fixtures: readonly Fixture[] = [
  { name: 'prose/001-long-line', input: longLineIn, expected: longLineOut },
  { name: 'prose/002-short-lines-joined', input: shortLinesIn, expected: shortLinesOut },
  {
    name: 'prose/003-already-wrapped-byte-identical',
    input: alreadyWrappedIn,
    expected: alreadyWrappedOut,
  },
  {
    name: 'prose/004-section-body-and-comment',
    input: sectionBodyCommentIn,
    expected: sectionBodyCommentOut,
  },
  { name: 'lists/001-item-indentation', input: itemIndentationIn, expected: itemIndentationOut },
  {
    name: 'hard-breaks/001-double-backslash',
    input: doubleBackslashIn,
    expected: doubleBackslashOut,
  },
  {
    name: 'hard-breaks/002-newline-command',
    input: newlineCommandIn,
    expected: newlineCommandOut,
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
  registry.register(latexAdapter);
  parserManager = await ParserManager.create({ wasmDir: engineRoot, registry });
});

describe('LaTeX prose wrapping — end-to-end gold fixtures', () => {
  it.each(fixtures.map((f) => [f.name, f] as const))('%s', async (_name, fixture) => {
    const result = await wrapRegions(fixture.input, 'latex', 'all', config(), parserManager);
    const actual = applyTextEdits(fixture.input, result.edits);
    expect(actual).toBe(fixture.expected);
  });

  it('every fixture actually changes the source, except the already-wrapped one', () => {
    for (const fixture of fixtures) {
      if (fixture.name === 'prose/003-already-wrapped-byte-identical') {
        expect(fixture.expected).toBe(fixture.input);
        continue;
      }
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

  it('produces no reflowed line over the column limit for any fixture', async () => {
    for (const fixture of fixtures) {
      const result = await wrapRegions(fixture.input, 'latex', 'all', config(), parserManager);
      const actual = applyTextEdits(fixture.input, result.edits);
      for (const line of actual.split('\n')) {
        expect(line.length).toBeLessThanOrEqual(COLUMN_LIMIT);
      }
    }
  });

  it('the item-indentation fixture aligns continuation lines under the \\item marker, not the item text', () => {
    const continuationLines = itemIndentationOut
      .split('\n')
      .filter((line) => line.startsWith('  ') && !line.trimStart().startsWith('\\item'));
    expect(continuationLines.length).toBeGreaterThan(0);
    for (const line of continuationLines) {
      expect(line.startsWith('  ')).toBe(true);
      expect(line.startsWith('   ')).toBe(false); // exactly two spaces, matching \item's own column
    }
  });

  it('a \\\\ hard break keeps its own line from absorbing the following line\'s first word', () => {
    const firstLine = doubleBackslashOut.split('\n')[0]!;
    expect(firstLine).toBe('Short line one.\\\\');
  });

  it('a \\newline hard break keeps its own line from absorbing the following line\'s first word', () => {
    const firstLine = newlineCommandOut.split('\n')[0]!;
    expect(firstLine).toBe('Short line one.\\newline');
  });
});
