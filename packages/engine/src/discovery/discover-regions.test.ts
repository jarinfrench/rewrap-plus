import { Parser, Language } from 'web-tree-sitter';
import { beforeAll, describe, expect, it } from 'vitest';
import type { LanguageAdapter, LanguageDescriptor } from '../types/adapter.js';
import type { RegionKind, WrappableRegion } from '../types/region.js';
import type { Tree } from '../types/tree-sitter-types.js';
import { discoverRegions } from './discover-regions.js';

// Relative to the process's cwd, which Vitest sets to this package's root
// (`packages/engine`) — same convention as every other grammar-loading
// test in this package.
const grammarPath = 'grammars/tree-sitter-python.wasm';

let parser: Parser;

beforeAll(async () => {
  await Parser.init();
  const language = await Language.load(grammarPath);
  parser = new Parser();
  parser.setLanguage(language);
});

// A deliberately bare-bones descriptor/adapter — no `classify`,
// `groupRegions`, or `concatenations` query. This is the point: it proves
// `discoverRegions` works from descriptor data alone, with no
// language-specific code anywhere. The real Python adapter (added over
// the rest of Phase 3) is exercised separately in
// `../languages/python/*.test.ts` and the fixture suite.
function minimalDescriptor(): LanguageDescriptor {
  return {
    id: 'python',
    grammarWasm: grammarPath,
    queries: {
      comments: '(comment) @comment',
      strings: '(string) @string',
    },
    comments: {
      line: { marker: '#', spaceAfter: true },
      neverReflow: [],
    },
    strings: {
      quotes: [
        { delimiter: '"', multiline: false, escapes: true },
        { delimiter: '"""', multiline: true, escapes: true },
      ],
      prefixes: [],
      rawForms: [],
      escapes: { sequences: [] },
      placeholders: [],
      concatenation: { style: 'implicit' },
    },
  };
}

function parseSource(source: string): Tree {
  const tree = parser.parse(source);
  if (!tree) {
    throw new Error('test setup: parser.parse returned null');
  }
  return tree;
}

function byKind(regions: readonly WrappableRegion[], kind: RegionKind): WrappableRegion[] {
  return regions.filter((r) => r.kind === kind);
}

describe('discoverRegions', () => {
  it('discovers comments and string literals with the default kind fallback', () => {
    const source = '# a comment\nx = "hello"\n';
    const tree = parseSource(source);
    const adapter: LanguageAdapter = { descriptor: minimalDescriptor() };

    const regions = discoverRegions(adapter, tree, source, 'python');

    expect(byKind(regions, 'lineComment')).toHaveLength(1);
    expect(byKind(regions, 'stringLiteral')).toHaveLength(1);
  });

  it('builds single-part regions whose span equals parts[0]', () => {
    const source = 'x = "hello"\n';
    const tree = parseSource(source);
    const adapter: LanguageAdapter = { descriptor: minimalDescriptor() };

    const [region] = discoverRegions(adapter, tree, source, 'python');

    expect(region!.parts).toEqual([region!.span]);
    expect(region!.rawText).toBe('"hello"');
    expect(region!.languageId).toBe('python');
  });

  it('returns regions sorted by position regardless of query capture order', () => {
    const source = 'x = "first"\n# a comment\ny = "second"\n';
    const tree = parseSource(source);
    const adapter: LanguageAdapter = { descriptor: minimalDescriptor() };

    const regions = discoverRegions(adapter, tree, source, 'python');

    expect(regions.map((r) => r.rawText)).toEqual(['"first"', '# a comment', '"second"']);
  });

  it('computes indentColumn with tabs expanded, defaulting tabSize to 4', () => {
    const source = 'if True:\n\tx = "indented"\n';
    const tree = parseSource(source);
    const adapter: LanguageAdapter = { descriptor: minimalDescriptor() };

    const [region] = discoverRegions(adapter, tree, source, 'python');

    // One leading tab expands to column 4 at the default tab size, then
    // `x = ` (4 more columns) before the string starts.
    expect(region!.indentColumn).toBe(8);
  });

  it('respects an explicit tabSize option', () => {
    const source = '\tx = "indented"\n';
    const tree = parseSource(source);
    const adapter: LanguageAdapter = { descriptor: minimalDescriptor() };

    const [region] = discoverRegions(adapter, tree, source, 'python', { tabSize: 2 });

    expect(region!.indentColumn).toBe(2 + 'x = '.length);
  });

  it('excludes a node when classify returns null, distinct from classify being absent', () => {
    const source = 'x = "keep"\ny = "drop"\n';
    const tree = parseSource(source);
    const adapter: LanguageAdapter = {
      descriptor: minimalDescriptor(),
      classify: (node) => (node.text.includes('drop') ? null : 'stringLiteral'),
    };

    const regions = discoverRegions(adapter, tree, source, 'python');

    expect(regions.map((r) => r.rawText)).toEqual(['"keep"']);
  });

  it('uses classify to assign a non-default kind', () => {
    const source = '"""a docstring"""\n';
    const tree = parseSource(source);
    const adapter: LanguageAdapter = {
      descriptor: minimalDescriptor(),
      classify: () => 'docstring',
    };

    const [region] = discoverRegions(adapter, tree, source, 'python');

    expect(region!.kind).toBe('docstring');
  });

  it('applies groupRegions as a final pass over the flat region list', () => {
    const source = 'x = "a"\ny = "b"\n';
    const tree = parseSource(source);
    const adapter: LanguageAdapter = {
      descriptor: minimalDescriptor(),
      groupRegions: (regions) =>
        regions.filter((r) => r.kind !== 'stringLiteral' || r.rawText === '"a"'),
    };

    const regions = discoverRegions(adapter, tree, source, 'python');

    expect(regions.map((r) => r.rawText)).toEqual(['"a"']);
  });

  it('returns an empty list for a file with nothing wrappable', () => {
    const source = 'x = 1\ny = 2\n';
    const tree = parseSource(source);
    const adapter: LanguageAdapter = { descriptor: minimalDescriptor() };

    expect(discoverRegions(adapter, tree, source, 'python')).toEqual([]);
  });
});
