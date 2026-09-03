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
import sectionWithLabelIn from '../fixtures/latex/prose/005-section-with-label.in.tex?raw';
import sectionWithLabelOut from '../fixtures/latex/prose/005-section-with-label.out.tex?raw';
import itemIndentationIn from '../fixtures/latex/lists/001-item-indentation.in.tex?raw';
import itemIndentationOut from '../fixtures/latex/lists/001-item-indentation.out.tex?raw';
import itemWithLabelIn from '../fixtures/latex/lists/002-item-with-label.in.tex?raw';
import itemWithLabelOut from '../fixtures/latex/lists/002-item-with-label.out.tex?raw';
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
 *
 * `prose/005-section-with-label` is a post-review addition: a real-world
 * proof that `\section{Title}\label{sec:foo}` — chained structural
 * commands on one line, an extremely common idiom — stays untouched
 * end-to-end through the full pipeline, not just at the discovery-level
 * unit-test layer (`../../src/languages/latex/discover-prose.test.ts`'s
 * own "chained structural commands" cases). Discovery originally treated
 * this as ordinary prose, confirmed empirically to actually get reflowed
 * for a long enough label — fixed in `discoverLatexProse`'s
 * `structuralConsumedLength`.
 *
 * `lists/002-item-with-label` is the related follow-up fix: the same
 * `\label{...}` chaining, but immediately after `\item` rather than a
 * sectioning command — `buildEnumItemStartColumns` originally had no
 * concept of a chain either, so `\item \label{item:foo} text` folded
 * the label into the item's own discovered prose text. Fixed by reusing
 * `structuralConsumedLength` there too, advancing the item's
 * content-start column past any chained commands right after the
 * marker.
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
  {
    name: 'prose/005-section-with-label',
    input: sectionWithLabelIn,
    expected: sectionWithLabelOut,
  },
  { name: 'lists/001-item-indentation', input: itemIndentationIn, expected: itemIndentationOut },
  { name: 'lists/002-item-with-label', input: itemWithLabelIn, expected: itemWithLabelOut },
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

  it('item continuation lines use the width the marker column actually leaves available, not the narrower content-start-column budget (the firstLineReserve fix)', () => {
    // Before the fix, reflow budgeted every line (including continuation
    // lines that only carry a 2-space prefix) as if it started at the
    // item's own *content* column — needlessly narrow. "wrapping onto a
    // continuation line." (35 chars) plus a 2-space prefix is 37 columns,
    // comfortably inside the 40-column limit, and previously got split
    // across two lines regardless.
    const lines = itemIndentationOut.split('\n');
    expect(lines).toContain('  wrapping onto a continuation line.');
  });

  it('item-with-label continuation lines get the same full-width treatment', () => {
    const lines = itemWithLabelOut.split('\n');
    expect(lines).toContain('  a chained cross-reference label and');
  });

  it('a \\section{Title}\\label{sec:foo} header line survives byte-identical, even though its body prose wraps', () => {
    const headerLine = sectionWithLabelOut.split('\n')[0]!;
    expect(headerLine).toBe('\\section{Introduction}\\label{sec:intro}');
    expect(sectionWithLabelOut).not.toBe(sectionWithLabelIn); // the body paragraph did wrap
  });

  it('a \\label{...} chained after \\item survives intact, never wrapped as if it were item text', () => {
    const firstLine = itemWithLabelOut.split('\n')[1]!; // line 0 is \begin{itemize}
    expect(firstLine.trimStart().startsWith('\\item \\label{item:first}')).toBe(true);
    // The label itself is never split across the reflow, no matter how
    // the item's own following text wraps.
    expect(itemWithLabelOut).toContain('\\label{item:first}');
    expect(itemWithLabelOut.match(/\\label\{item:first\}/g)).toHaveLength(1);
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
