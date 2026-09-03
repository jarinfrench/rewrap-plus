import { Parser, Language } from 'web-tree-sitter';
import { beforeAll, describe, expect, it } from 'vitest';
import { discoverRegions } from '../../discovery/discover-regions.js';
import { latexAdapter } from './adapter.js';

let parser: Parser;

beforeAll(async () => {
  await Parser.init();
  parser = new Parser();
  parser.setLanguage(await Language.load('grammars/tree-sitter-latex.wasm'));
});

describe('latexAdapter', () => {
  it('classifies a % comment as lineComment', () => {
    const source = '% a comment\n\\section{Title}\n';
    const tree = parser.parse(source)!;
    const [region] = discoverRegions(latexAdapter, tree, source, 'latex');
    expect(region!.kind).toBe('lineComment');
  });

  it('discovers zero regions for a file with no comments at all', () => {
    const source = '\\section{Title}\nSome body text here.\n';
    const tree = parser.parse(source)!;
    const regions = discoverRegions(latexAdapter, tree, source, 'latex');
    expect(regions).toEqual([]);
  });

  it('does not treat an escaped \\% as a comment', () => {
    const source = 'text \\% not a comment, 100\\% done\n';
    const tree = parser.parse(source)!;
    const regions = discoverRegions(latexAdapter, tree, source, 'latex');
    expect(regions).toEqual([]);
  });

  it('groups consecutive same-indent % comment lines into one multi-part region', () => {
    const source = '% first line\n% second line\n\\section{Title}\n';
    const tree = parser.parse(source)!;
    const regions = discoverRegions(latexAdapter, tree, source, 'latex');
    expect(regions).toHaveLength(1);
    expect(regions[0]!.kind).toBe('lineComment');
    expect(regions[0]!.parts).toHaveLength(2);
  });

  it('does not merge two comment runs separated by a non-comment line', () => {
    const source = '% first block\n\\section{Title}\n% second block\n';
    const tree = parser.parse(source)!;
    const regions = discoverRegions(latexAdapter, tree, source, 'latex');
    expect(regions).toHaveLength(2);
    expect(regions.every((region) => region.kind === 'lineComment')).toBe(true);
    expect(regions.every((region) => region.parts.length === 1)).toBe(true);
  });

  it('does not merge comments at different indent columns', () => {
    const source = '% top level\n  % indented differently\n';
    const tree = parser.parse(source)!;
    const regions = discoverRegions(latexAdapter, tree, source, 'latex');
    expect(regions).toHaveLength(2);
  });
});
