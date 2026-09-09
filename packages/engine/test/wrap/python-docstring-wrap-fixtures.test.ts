import { beforeAll, describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../../src/adapter-registry.js';
import { applyTextEdits } from '../../src/apply-edits.js';
import { ParserManager } from '../../src/parser/parser-manager.js';
import type { WrapConfig } from '../../src/types/config.js';
import { pythonAdapter } from '../../src/languages/python/adapter.js';
import { wrapRegions } from '../../src/wrap.js';

import minimalIn from '../fixtures/python/docstrings/001-minimal-plain.in.py?raw';
import minimalOut from '../fixtures/python/docstrings/001-minimal-plain.out.py?raw';
import googleIn from '../fixtures/python/docstrings/002-google-style.in.py?raw';
import googleOut from '../fixtures/python/docstrings/002-google-style.out.py?raw';
import numpyIn from '../fixtures/python/docstrings/003-numpy-style.in.py?raw';
import numpyOut from '../fixtures/python/docstrings/003-numpy-style.out.py?raw';
import sphinxIn from '../fixtures/python/docstrings/004-sphinx-style.in.py?raw';
import sphinxOut from '../fixtures/python/docstrings/004-sphinx-style.out.py?raw';
import alreadyWrappedIn from '../fixtures/python/docstrings/005-already-wrapped-byte-identical.in.py?raw';
import alreadyWrappedOut from '../fixtures/python/docstrings/005-already-wrapped-byte-identical.out.py?raw';
import doctestIn from '../fixtures/python/docstrings/006-doctest-preserved.in.py?raw';
import doctestOut from '../fixtures/python/docstrings/006-doctest-preserved.out.py?raw';
import multiRegionIn from '../fixtures/python/docstrings/007-module-class-attribute-docstrings.in.py?raw';
import multiRegionOut from '../fixtures/python/docstrings/007-module-class-attribute-docstrings.out.py?raw';
import quoteAloneMultiParaIn from '../fixtures/python/docstrings/008-quote-alone-multi-paragraph.in.py?raw';
import quoteAloneMultiParaOut from '../fixtures/python/docstrings/008-quote-alone-multi-paragraph.out.py?raw';
import minimalGoogleIn from '../fixtures/python/docstrings/009-minimal-google.in.py?raw';
import minimalGoogleOut from '../fixtures/python/docstrings/009-minimal-google.out.py?raw';
import minimalNumpyIn from '../fixtures/python/docstrings/010-minimal-numpy.in.py?raw';
import minimalNumpyOut from '../fixtures/python/docstrings/010-minimal-numpy.out.py?raw';
import minimalSphinxIn from '../fixtures/python/docstrings/011-minimal-sphinx.in.py?raw';
import minimalSphinxOut from '../fixtures/python/docstrings/011-minimal-sphinx.out.py?raw';
import pathologicalGoogleIn from '../fixtures/python/docstrings/012-pathological-google.in.py?raw';
import pathologicalGoogleOut from '../fixtures/python/docstrings/012-pathological-google.out.py?raw';
import pathologicalNumpyIn from '../fixtures/python/docstrings/013-pathological-numpy.in.py?raw';
import pathologicalNumpyOut from '../fixtures/python/docstrings/013-pathological-numpy.out.py?raw';
import pathologicalSphinxIn from '../fixtures/python/docstrings/014-pathological-sphinx.in.py?raw';
import pathologicalSphinxOut from '../fixtures/python/docstrings/014-pathological-sphinx.out.py?raw';
import alreadyWrappedNumpyIn from '../fixtures/python/docstrings/015-already-wrapped-numpy-byte-identical.in.py?raw';
import alreadyWrappedNumpyOut from '../fixtures/python/docstrings/015-already-wrapped-numpy-byte-identical.out.py?raw';
import alreadyWrappedSphinxIn from '../fixtures/python/docstrings/016-already-wrapped-sphinx-byte-identical.in.py?raw';
import alreadyWrappedSphinxOut from '../fixtures/python/docstrings/016-already-wrapped-sphinx-byte-identical.out.py?raw';
import blankLineSeparatedGoogleIn from '../fixtures/python/docstrings/017-blank-line-separated-google.in.py?raw';
import blankLineSeparatedGoogleOut from '../fixtures/python/docstrings/017-blank-line-separated-google.out.py?raw';
import blankLineSeparatedNumpyIn from '../fixtures/python/docstrings/018-blank-line-separated-numpy.in.py?raw';
import blankLineSeparatedNumpyOut from '../fixtures/python/docstrings/018-blank-line-separated-numpy.out.py?raw';
import indentedProseSectionsIn from '../fixtures/python/docstrings/019-indented-prose-sections.in.py?raw';
import indentedProseSectionsOut from '../fixtures/python/docstrings/019-indented-prose-sections.out.py?raw';

/**
 * The stated acceptance criterion: "All docstring fixtures pass; no
 * dialect's structural markers are lost." Mirrors
 * `./python-comment-wrap-fixtures.test.ts`'s own structure and rationale
 * for this project's established fixture-driven convention — static
 * `?raw` imports rather than a directory walk, so a missing or misnamed
 * `.out.py` is a compile-time import error, not a silently-skipped test.
 *
 * Column limit is a fixed 50 for every fixture — wide enough that
 * Google/NumPy/Sphinx section structure stays legible in the gold files
 * while still forcing every fixture's content to actually wrap (every
 * source docstring was written specifically to overflow this limit),
 * except 006 (`006-doctest-preserved`), whose whole point is a doctest
 * line that overflows *regardless* of width, and 005/015/016 (the
 * `*-already-wrapped-byte-identical` fixtures, one per dialect), whose
 * point is that wrapping already-correct output changes nothing.
 *
 * 009-011 (`minimal-{google,numpy,sphinx}`) and 012-014
 * (`pathological-{google,numpy,sphinx}`) round out each dialect's own
 * fixture tier alongside its existing "typical" case (002/003/004): a
 * minimal one-section instance, and a pathological one combining a very
 * long field label (an extreme hanging indent, forcing the one-word-per-
 * line overflow rule), a nested list inside a field-entry description, a
 * fenced code sample inside a field-entry description, and non-ASCII
 * content. As of
 * `docs/planning/nested-field-entry-structure-plan.md`'s step 3/4, both
 * the nested list and the fenced sample in 012-014 reflow as real,
 * preserved structure (a `listItem`/`verbatim` `Block`, per
 * `../../src/types/document.ts`'s `fieldEntry.blocks`) — they used to
 * flatten to plain reflowed prose (`../../src/docs/field-entries.ts`'s
 * "Known limitation" note documented that degradation; it's since been
 * rewritten to describe the current, much narrower residual gap). 012-014
 * deliberately still have no blank line *inside* the nested content,
 * though (unbroken continuation only) — that's what 017-018 add, below.
 *
 * 017-018 (`blank-line-separated-{google,numpy}`) cover the case 012-014
 * were deliberately written to avoid until now: a genuine blank line
 * *inside* a field entry's description (separating prose from a nested
 * list, and the list from a fenced sample) — historically the highest-risk
 * shape, since a blank line used to end an entry's continuation outright
 * (the flat-collection loop's own "known limitation," fixed by the
 * look-ahead collection in step 2) and, before *that*, was the exact
 * pattern implicated in the idempotency bug `docs: fix field-entry
 * misparsing that broke docstring wrap idempotency` closed. One fixture
 * per genuinely distinct implementation, not one per dialect: Google
 * exercises the shared `groupFieldEntries` path (Sphinx/JSDoc/Doxygen/
 * Javadoc all reuse it unchanged, already covered at the `segment()` unit
 * level in their own test files), NumPy exercises its own separate
 * `segmentFieldSection`.
 *
 * 019 (`indented-prose-sections`) is the one fixture in this file that
 * overrides `preserveIndentedBlocks` to `true` (every other fixture here
 * runs with it `false` -- see `config`, below) -- the default in both the
 * CLI (`packages/cli/src/config/defaults.ts`) and the VSCode extension
 * (`packages/vscode-extension/README.md`), unlike every fixture above.
 * Regression coverage for a real bug: a Google section body sits at a
 * hanging indent under its flush-left header by convention, uniformly
 * indented from its very first line, which `preserveIndentedBlocks`'s
 * "any indented line becomes verbatim" rule
 * (`../../src/segmentation/split-blocks.ts`) misread as a nested indented
 * block *at the wrong baseline* and never reflowed at all, for both a
 * bare (nameless) `Returns:` body and any `PROSE_SECTIONS` body (`Note`,
 * `Example`, etc.). Fixed by threading a `baselineIndent` option through
 * `splitBlocks`/`matchIndentedRun` (`../../src/segmentation/verbatim.ts`)
 * so the indented-block heuristic compares against the section's own
 * established margin instead of column 0, computed non-destructively via
 * `../../src/docs/field-entries.ts`'s `commonIndent` and passed alongside
 * the untouched section body to `segmentLines`
 * (`../../src/docs/google.ts`'s `segment`) -- physically dedenting the
 * body first (mirroring `dedentBody`, the fix this replaced) reflows the
 * prose correctly too, but was ruled out because it truncates a nested
 * `verbatim` block's own preserved absolute indentation, confirmed as a
 * real regression against `006-doctest-preserved`. Confirmed via the CLI
 * before the fix: 0 lines rewrapped despite both section bodies being
 * far over the column limit. See the equivalent, narrower-scoped
 * unit-level regression cases in `../../src/docs/google.test.ts` and
 * `../../src/docs/numpy.test.ts` for the same fix applied to NumPy's own
 * `PROSE_SECTIONS` branch (`../../src/docs/numpy.ts`).
 */
const COLUMN_LIMIT = 50;

interface Fixture {
  readonly name: string;
  readonly input: string;
  readonly expected: string;
  readonly configOverrides?: Partial<WrapConfig>;
}

const fixtures: readonly Fixture[] = [
  { name: '001-minimal-plain', input: minimalIn, expected: minimalOut },
  { name: '002-google-style', input: googleIn, expected: googleOut },
  { name: '003-numpy-style', input: numpyIn, expected: numpyOut },
  { name: '004-sphinx-style', input: sphinxIn, expected: sphinxOut },
  {
    name: '005-already-wrapped-byte-identical',
    input: alreadyWrappedIn,
    expected: alreadyWrappedOut,
  },
  { name: '006-doctest-preserved', input: doctestIn, expected: doctestOut },
  {
    name: '007-module-class-attribute-docstrings',
    input: multiRegionIn,
    expected: multiRegionOut,
  },
  {
    name: '008-quote-alone-multi-paragraph',
    input: quoteAloneMultiParaIn,
    expected: quoteAloneMultiParaOut,
  },
  { name: '009-minimal-google', input: minimalGoogleIn, expected: minimalGoogleOut },
  { name: '010-minimal-numpy', input: minimalNumpyIn, expected: minimalNumpyOut },
  { name: '011-minimal-sphinx', input: minimalSphinxIn, expected: minimalSphinxOut },
  {
    name: '012-pathological-google',
    input: pathologicalGoogleIn,
    expected: pathologicalGoogleOut,
  },
  {
    name: '013-pathological-numpy',
    input: pathologicalNumpyIn,
    expected: pathologicalNumpyOut,
  },
  {
    name: '014-pathological-sphinx',
    input: pathologicalSphinxIn,
    expected: pathologicalSphinxOut,
  },
  {
    name: '015-already-wrapped-numpy-byte-identical',
    input: alreadyWrappedNumpyIn,
    expected: alreadyWrappedNumpyOut,
  },
  {
    name: '016-already-wrapped-sphinx-byte-identical',
    input: alreadyWrappedSphinxIn,
    expected: alreadyWrappedSphinxOut,
  },
  {
    name: '017-blank-line-separated-google',
    input: blankLineSeparatedGoogleIn,
    expected: blankLineSeparatedGoogleOut,
  },
  {
    name: '018-blank-line-separated-numpy',
    input: blankLineSeparatedNumpyIn,
    expected: blankLineSeparatedNumpyOut,
  },
  {
    name: '019-indented-prose-sections',
    input: indentedProseSectionsIn,
    expected: indentedProseSectionsOut,
    configOverrides: { preserveIndentedBlocks: true },
  },
];

function config(overrides: Partial<WrapConfig> = {}): WrapConfig {
  return {
    columnLimit: COLUMN_LIMIT,
    tabSize: 4,
    wrapComments: true,
    wrapStrings: false,
    stringPolicy: 'off',
    docDialect: 'auto',
    preserveIndentedBlocks: false,
    balancedWrapping: false,
    ...overrides,
  };
}

// `.` resolves against Vitest's cwd (this package's root) — see
// `../../src/parser/parser-manager.test.ts` for the same pattern.
const engineRoot = '.';

let parserManager: ParserManager;

beforeAll(async () => {
  const registry = new AdapterRegistry();
  registry.register(pythonAdapter);
  parserManager = await ParserManager.create({ wasmDir: engineRoot, registry });
});

describe('Python docstring wrapping — end-to-end gold fixtures', () => {
  it.each(fixtures.map((f) => [f.name, f] as const))('%s', async (_name, fixture) => {
    const result = await wrapRegions(
      fixture.input,
      'python',
      'all',
      config(fixture.configOverrides),
      parserManager,
    );
    const actual = applyTextEdits(fixture.input, result.edits);
    expect(actual).toBe(fixture.expected);
  });

  it('produces no reflowed line over the column limit, except a lone unbreakable atom or verbatim content (006’s doctest, 012/014’s fenced sample)', async () => {
    // Mirrors `./python-comment-wrap-fixtures.test.ts`'s own "only this
    // phase's concern" scoping: a `def`/`return` code line untouched by
    // docstring wrapping is free to be any length — this check is about
    // the overflow rule for *reflowed docstring content*, not incidental
    // code around it. A `"""` toggles whether subsequent lines are inside
    // the docstring; the delimiter's own line counts as docstring content
    // either way (it carries the summary or the closing quote).
    for (const fixture of fixtures) {
      const result = await wrapRegions(
        fixture.input,
        'python',
        'all',
        config(fixture.configOverrides),
        parserManager,
      );
      const actual = applyTextEdits(fixture.input, result.edits);
      let insideDocstring = false;
      let insideFence = false;
      for (const line of actual.split(/\r?\n/)) {
        const opensOrClosesHere = /"""/.test(line);
        const isDocstringLine = insideDocstring || opensOrClosesHere;
        if (opensOrClosesHere) {
          insideDocstring = !insideDocstring;
        }
        const trimmed = line.trimStart();
        // A fenced code sample (now reachable *inside* a field entry's
        // own description too, once `groupFieldEntries` started routing
        // descriptions through `../../src/segmentation/split-blocks.ts`
        // — see `012-pathological-google.out.py`/`014-pathological-sphinx.out.py`)
        // is `verbatim`: never reflowed, categorically exempt from the
        // overflow rule for its *entire* content, not just a single
        // token — mirrors `../../src/segmentation/verbatim.ts`'s own
        // `FENCE_OPEN` delimiter recognition. `isFenceDelimiter` covers
        // the toggling line itself regardless of which side of the
        // toggle it's read on.
        const isFenceDelimiter = /^(`{3,}|~{3,})/.test(trimmed);
        if (isFenceDelimiter) {
          insideFence = !insideFence;
        }
        if (!isDocstringLine || line.length <= COLUMN_LIMIT) {
          continue;
        }
        if (insideFence || isFenceDelimiter) {
          continue;
        }
        // Legitimate only as the overflow rule: a lone unbreakable
        // token — the doctest fixture's `>>>`/`...` line, a field
        // entry's continuation line under a hanging indent too deep to
        // leave room for even one word, or a field entry's *first*
        // line, where a structural label (`'name:'`, `':param x:'`)
        // legitimately precedes that same lone overflowing token
        // (`012-pathological-google.out.py`'s
        // `really_long_deployment_target_identifier: A`, for example —
        // the label is `decorateFirstLine`'s own prefix, not reflowed
        // content, so its internal spacing doesn't count against "one
        // token"). Stripping up to the first `':' + whitespace` removes
        // any such label before checking; a continuation line with no
        // label is unaffected, since nothing in it matches that pattern.
        if (/^(>>>|\.\.\.)/.test(trimmed)) {
          continue;
        }
        const content = trimmed.replace(/^.*?:\s/, '');
        expect(content).not.toMatch(/\s/);
      }
    }
  });

  it('is idempotent: re-wrapping the gold output produces no further edits', async () => {
    for (const fixture of fixtures) {
      const result = await wrapRegions(
        fixture.expected,
        'python',
        'all',
        config(fixture.configOverrides),
        parserManager,
      );
      expect(result.edits).toEqual([]);
    }
  });

  it('leaves the already-wrapped fixtures byte-identical', () => {
    expect(alreadyWrappedIn).toBe(alreadyWrappedOut);
    expect(alreadyWrappedNumpyIn).toBe(alreadyWrappedNumpyOut);
    expect(alreadyWrappedSphinxIn).toBe(alreadyWrappedSphinxOut);
  });

  it('preserves the doctest block verbatim, including its over-limit line', () => {
    expect(doctestOut).toContain(
      '        >>> add(-1000000, 2000000)  # a long doctest line that must never be reflowed',
    );
  });

  it('covers the cases docstring wrapping is meant to handle', () => {
    // Not a behavioral assertion — a guard against silently losing
    // coverage of one of these named cases (minimal/plain, each of the
    // three dialects at its typical/minimal/pathological tiers, an
    // already-correctly-wrapped case per dialect, doctest preservation,
    // module/class/attribute docstrings discovered and wrapped together,
    // and a blank-line-separated nested example per genuinely distinct
    // field-entry implementation) if a fixture were ever renamed or
    // removed without a replacement.
    expect(fixtures.map((f) => f.name)).toEqual([
      '001-minimal-plain',
      '002-google-style',
      '003-numpy-style',
      '004-sphinx-style',
      '005-already-wrapped-byte-identical',
      '006-doctest-preserved',
      '007-module-class-attribute-docstrings',
      '008-quote-alone-multi-paragraph',
      '009-minimal-google',
      '010-minimal-numpy',
      '011-minimal-sphinx',
      '012-pathological-google',
      '013-pathological-numpy',
      '014-pathological-sphinx',
      '015-already-wrapped-numpy-byte-identical',
      '016-already-wrapped-sphinx-byte-identical',
      '017-blank-line-separated-google',
      '018-blank-line-separated-numpy',
      '019-indented-prose-sections',
    ]);
  });
});
