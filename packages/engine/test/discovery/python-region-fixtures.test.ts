import { Parser, Language } from 'web-tree-sitter';
import { beforeAll, describe, expect, it } from 'vitest';
import { discoverRegions } from '../../src/discovery/discover-regions.js';
import { pythonAdapter } from '../../src/languages/python/adapter.js';

import moduleDocstringSource from '../fixtures/python/regions/001-module-docstring.py?raw';
import moduleDocstringExpected from '../fixtures/python/regions/001-module-docstring.expected.json';
import nestedFunctionsSource from '../fixtures/python/regions/002-nested-functions.py?raw';
import nestedFunctionsExpected from '../fixtures/python/regions/002-nested-functions.expected.json';
import classDocstringSource from '../fixtures/python/regions/003-class-docstring.py?raw';
import classDocstringExpected from '../fixtures/python/regions/003-class-docstring.expected.json';
import dictLiteralStringsSource from '../fixtures/python/regions/004-dict-literal-strings.py?raw';
import dictLiteralStringsExpected from '../fixtures/python/regions/004-dict-literal-strings.expected.json';
import fstringInterpolationSource from '../fixtures/python/regions/005-fstring-interpolation.py?raw';
import fstringInterpolationExpected from '../fixtures/python/regions/005-fstring-interpolation.expected.json';
import rawRegexStringSource from '../fixtures/python/regions/006-raw-regex-string.py?raw';
import rawRegexStringExpected from '../fixtures/python/regions/006-raw-regex-string.expected.json';
import implicitConcatenationSource from '../fixtures/python/regions/007-implicit-concatenation.py?raw';
import implicitConcatenationExpected from '../fixtures/python/regions/007-implicit-concatenation.expected.json';
import plusConcatenationSource from '../fixtures/python/regions/008-plus-concatenation.py?raw';
import plusConcatenationExpected from '../fixtures/python/regions/008-plus-concatenation.expected.json';
import comprehensionStringsSource from '../fixtures/python/regions/009-comprehension-strings.py?raw';
import comprehensionStringsExpected from '../fixtures/python/regions/009-comprehension-strings.expected.json';

/**
 * Phase 3's stated acceptance criterion: "For each fixture, discovered
 * regions match a checked-in expected list (kind, span, part count)."
 *
 * Each fixture pairs a standalone `.py` source file with a checked-in
 * `.expected.json` gold file, per the project's own testing convention
 * ("edge-case coverage lives in checked-in files, not assertions") —
 * rather than one large table of inline assertions, each fixture is a
 * real Python file a human can open and read on its own.
 *
 * Fixtures are imported statically (both the `.py` source, as raw text
 * via Vite's `?raw` suffix — see `../raw-import.d.ts` for why not
 * `node:fs` — and the `.expected.json`, which TypeScript's
 * `resolveJsonModule` already handles natively) rather than discovered by
 * walking the fixtures directory at runtime. A directory walk would need
 * `node:fs` for the same reason raw source loading does, and — as a
 * secondary benefit — a missing or misnamed `.expected.json` becomes a
 * compile-time import error here instead of a test that silently never
 * ran.
 *
 * Each expected entry also carries `rawText`, even though the acceptance
 * criterion above only asks for kind/span/part-count: it's what actually
 * makes a failing diff readable (a mismatched `startColumn` on its own
 * doesn't say *which* string moved) without changing what's being
 * asserted.
 */
const grammarPath = 'grammars/tree-sitter-python.wasm';

interface ExpectedRegion {
  readonly kind: string;
  readonly startRow: number;
  readonly startColumn: number;
  readonly endRow: number;
  readonly endColumn: number;
  readonly partCount: number;
  readonly rawText: string;
}

interface Fixture {
  readonly name: string;
  readonly source: string;
  readonly expected: readonly ExpectedRegion[];
}

const fixtures: readonly Fixture[] = [
  {
    name: '001-module-docstring',
    source: moduleDocstringSource,
    expected: moduleDocstringExpected,
  },
  {
    name: '002-nested-functions',
    source: nestedFunctionsSource,
    expected: nestedFunctionsExpected,
  },
  { name: '003-class-docstring', source: classDocstringSource, expected: classDocstringExpected },
  {
    name: '004-dict-literal-strings',
    source: dictLiteralStringsSource,
    expected: dictLiteralStringsExpected,
  },
  {
    name: '005-fstring-interpolation',
    source: fstringInterpolationSource,
    expected: fstringInterpolationExpected,
  },
  { name: '006-raw-regex-string', source: rawRegexStringSource, expected: rawRegexStringExpected },
  {
    name: '007-implicit-concatenation',
    source: implicitConcatenationSource,
    expected: implicitConcatenationExpected,
  },
  {
    name: '008-plus-concatenation',
    source: plusConcatenationSource,
    expected: plusConcatenationExpected,
  },
  {
    name: '009-comprehension-strings',
    source: comprehensionStringsSource,
    expected: comprehensionStringsExpected,
  },
];

let parser: Parser;

beforeAll(async () => {
  await Parser.init();
  const language = await Language.load(grammarPath);
  parser = new Parser();
  parser.setLanguage(language);
});

describe('Python region discovery fixtures', () => {
  it.each(fixtures.map((f) => [f.name, f] as const))('%s', (_name, fixture) => {
    const tree = parser.parse(fixture.source);
    if (!tree) {
      throw new Error(`test setup: parser.parse returned null for fixture '${fixture.name}'`);
    }

    const regions = discoverRegions(pythonAdapter, tree, fixture.source, 'python');
    const actual: ExpectedRegion[] = regions.map((region) => ({
      kind: region.kind,
      startRow: region.span.startRow,
      startColumn: region.span.startColumn,
      endRow: region.span.endRow,
      endColumn: region.span.endColumn,
      partCount: region.parts.length,
      rawText: region.rawText,
    }));

    expect(actual).toEqual(fixture.expected);
  });

  it('covers the cases the plan calls out for this phase', () => {
    // Not a behavioral assertion — a guard against silently losing
    // coverage of one of the specific cases Phase 3's plan enumerates
    // (nested functions, class/module docstrings, dict-literal strings,
    // f-strings, raw regex strings, multi-line implicit concatenation,
    // `+`-concatenation, strings inside comprehensions) if a fixture were
    // ever renamed or removed without a replacement.
    expect(fixtures.map((f) => f.name)).toEqual([
      '001-module-docstring',
      '002-nested-functions',
      '003-class-docstring',
      '004-dict-literal-strings',
      '005-fstring-interpolation',
      '006-raw-regex-string',
      '007-implicit-concatenation',
      '008-plus-concatenation',
      '009-comprehension-strings',
    ]);
  });
});
