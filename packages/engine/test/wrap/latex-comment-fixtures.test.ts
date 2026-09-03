import { beforeAll, describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../../src/adapter-registry.js';
import { applyTextEdits } from '../../src/apply-edits.js';
import { ParserManager } from '../../src/parser/parser-manager.js';
import type { WrapConfig } from '../../src/types/config.js';
import { latexAdapter } from '../../src/languages/latex/adapter.js';
import { wrapRegions } from '../../src/wrap.js';

import longLineIn from '../fixtures/latex/comments/001-long-line.in.tex?raw';
import longLineOut from '../fixtures/latex/comments/001-long-line.out.tex?raw';
import shortLinesIn from '../fixtures/latex/comments/002-short-lines-joined.in.tex?raw';
import shortLinesOut from '../fixtures/latex/comments/002-short-lines-joined.out.tex?raw';
import alreadyWrappedIn from '../fixtures/latex/comments/003-already-wrapped-byte-identical.in.tex?raw';
import alreadyWrappedOut from '../fixtures/latex/comments/003-already-wrapped-byte-identical.out.tex?raw';
import magicCommentIn from '../fixtures/latex/comments/004-magic-comment-untouched.in.tex?raw';
import magicCommentOut from '../fixtures/latex/comments/004-magic-comment-untouched.out.tex?raw';
import bannerIn from '../fixtures/latex/comments/005-banner-and-paragraph.in.tex?raw';
import bannerOut from '../fixtures/latex/comments/005-banner-and-paragraph.out.tex?raw';
import commentedOutCodeIn from '../fixtures/latex/comments/006-commented-out-code-verbatim.in.tex?raw';
import commentedOutCodeOut from '../fixtures/latex/comments/006-commented-out-code-verbatim.out.tex?raw';
import blankSeparatedIn from '../fixtures/latex/comments/007-blank-comment-separates-paragraphs.in.tex?raw';
import blankSeparatedOut from '../fixtures/latex/comments/007-blank-comment-separates-paragraphs.out.tex?raw';
import codeUntouchedIn from '../fixtures/latex/comments/008-code-untouched-comment-wrapped.in.tex?raw';
import codeUntouchedOut from '../fixtures/latex/comments/008-code-untouched-comment-wrapped.out.tex?raw';

/**
 * The LaTeX adapter's first gold fixtures — `docs/planning/markdown-latex-plan.md`
 * Phase D commit 14, `%` comment paragraphs through the *existing*
 * `'lineComment'` machinery, no LaTeX-specific dissolve/emit code at all
 * (`../../src/languages/latex/adapter.ts`'s own doc comment). Each
 * `.out.tex` was produced by actually running this adapter's own
 * `wrapRegions` pipeline against the paired `.in.tex` (not hand-computed),
 * then verified — idempotent, no unexpectedly-skipped region — before
 * being committed as the gold file; this suite re-asserts all of that on
 * every run.
 *
 * `004`/`006` are deliberately *not* under the column limit in their
 * `.out.tex` — that's the fixture's whole point (a `neverReflow` magic
 * comment, and a commented-out-code run `looksLikeCommentedOutCode`
 * routes to `verbatim`), so the usual "no line over the limit" assertion
 * below is scoped to exclude them by name rather than silently weakened
 * for every fixture, the same targeted-scoping fix
 * `markdown-directive-fixtures.test.ts` already established for the
 * identical shape of problem (§Errors and fixes, Phase C commit 11).
 * `008`'s ordinary-text line is excluded for a different, adjacent reason:
 * it isn't inside a comment at all, and `discoverProse` doesn't exist yet
 * (commit 15) — nothing this commit's adapter could have wrapped it with.
 */
const COLUMN_LIMIT = 40;

interface Fixture {
  readonly name: string;
  readonly input: string;
  readonly expected: string;
}

const fixtures: readonly Fixture[] = [
  { name: '001-long-line', input: longLineIn, expected: longLineOut },
  { name: '002-short-lines-joined', input: shortLinesIn, expected: shortLinesOut },
  { name: '003-already-wrapped-byte-identical', input: alreadyWrappedIn, expected: alreadyWrappedOut },
  { name: '004-magic-comment-untouched', input: magicCommentIn, expected: magicCommentOut },
  { name: '005-banner-and-paragraph', input: bannerIn, expected: bannerOut },
  { name: '006-commented-out-code-verbatim', input: commentedOutCodeIn, expected: commentedOutCodeOut },
  {
    name: '007-blank-comment-separates-paragraphs',
    input: blankSeparatedIn,
    expected: blankSeparatedOut,
  },
  { name: '008-code-untouched-comment-wrapped', input: codeUntouchedIn, expected: codeUntouchedOut },
];

const NEVER_UNDER_LIMIT = new Set([
  '004-magic-comment-untouched',
  '006-commented-out-code-verbatim',
  '008-code-untouched-comment-wrapped',
]);

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

describe('LaTeX % comments — end-to-end gold fixtures', () => {
  it.each(fixtures.map((f) => [f.name, f] as const))('%s', async (_name, fixture) => {
    const result = await wrapRegions(fixture.input, 'latex', 'all', config(), parserManager);
    const actual = applyTextEdits(fixture.input, result.edits);
    expect(actual).toBe(fixture.expected);
  });

  it('every fixture actually changes the source, except the already-wrapped and never-reflow ones', () => {
    const untouched = new Set([
      '003-already-wrapped-byte-identical',
      '004-magic-comment-untouched',
      '006-commented-out-code-verbatim',
      '007-blank-comment-separates-paragraphs',
    ]);
    for (const fixture of fixtures) {
      if (untouched.has(fixture.name)) {
        expect(fixture.expected).toBe(fixture.input);
      } else {
        expect(fixture.expected).not.toBe(fixture.input);
      }
    }
  });

  it('is idempotent — wrapping already-wrapped output produces zero further edits', async () => {
    for (const fixture of fixtures) {
      const result = await wrapRegions(fixture.expected, 'latex', 'all', config(), parserManager);
      const reapplied = applyTextEdits(fixture.expected, result.edits);
      expect(reapplied).toBe(fixture.expected);
    }
  });

  it('produces no reflowed line over the column limit, except deliberately-verbatim/untouched fixtures', async () => {
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
});
