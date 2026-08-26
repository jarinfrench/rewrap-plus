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
 * while still forcing every fixture's content to actually wrap (all six
 * source docstrings were written specifically to overflow this limit),
 * except 006 (`006-doctest-preserved`), whose whole point is a doctest
 * line that overflows *regardless* of width, and 005
 * (`005-already-wrapped-byte-identical`), whose point is that wrapping
 * already-correct output changes nothing.
 */
const COLUMN_LIMIT = 50;

interface Fixture {
  readonly name: string;
  readonly input: string;
  readonly expected: string;
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
    const result = await wrapRegions(fixture.input, 'python', 'all', config(), parserManager);
    const actual = applyTextEdits(fixture.input, result.edits);
    expect(actual).toBe(fixture.expected);
  });

  it('produces no reflowed line over the column limit, except a lone unbreakable atom (006’s doctest)', async () => {
    for (const fixture of fixtures) {
      const result = await wrapRegions(fixture.input, 'python', 'all', config(), parserManager);
      const actual = applyTextEdits(fixture.input, result.edits);
      for (const line of actual.split(/\r?\n/)) {
        if (line.length <= COLUMN_LIMIT) {
          continue;
        }
        // The doctest fixture's whole point is a `>>>` line that
        // overflows regardless of width — verbatim, never reflowed.
        expect(line.trimStart()).toMatch(/^(>>>|\.\.\.)/);
      }
    }
  });

  it('is idempotent: re-wrapping the gold output produces no further edits', async () => {
    for (const fixture of fixtures) {
      const result = await wrapRegions(fixture.expected, 'python', 'all', config(), parserManager);
      expect(result.edits).toEqual([]);
    }
  });

  it('leaves the already-wrapped fixture byte-identical', () => {
    expect(alreadyWrappedIn).toBe(alreadyWrappedOut);
  });

  it('preserves the doctest block verbatim, including its over-limit line', () => {
    expect(doctestOut).toContain(
      '        >>> add(-1000000, 2000000)  # a long doctest line that must never be reflowed',
    );
  });

  it('covers the cases docstring wrapping is meant to handle', () => {
    // Not a behavioral assertion — a guard against silently losing
    // coverage of one of these named cases (minimal/plain, each of the
    // three dialects, an already-correctly-wrapped case, doctest
    // preservation, and module/class/attribute docstrings discovered
    // and wrapped together) if a fixture were ever renamed or removed
    // without a replacement.
    expect(fixtures.map((f) => f.name)).toEqual([
      '001-minimal-plain',
      '002-google-style',
      '003-numpy-style',
      '004-sphinx-style',
      '005-already-wrapped-byte-identical',
      '006-doctest-preserved',
      '007-module-class-attribute-docstrings',
      '008-quote-alone-multi-paragraph',
    ]);
  });
});
