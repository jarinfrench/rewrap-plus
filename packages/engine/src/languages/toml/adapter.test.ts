import { Parser, Language } from 'web-tree-sitter';
import { beforeAll, describe, expect, it } from 'vitest';
import { discoverRegions } from '../../discovery/discover-regions.js';
import { tomlAdapter } from './adapter.js';

let parser: Parser;

beforeAll(async () => {
  await Parser.init();
  parser = new Parser();
  parser.setLanguage(await Language.load('grammars/tree-sitter-toml.wasm'));
});

describe('tomlAdapter', () => {
  it('classifies a standalone # comment as lineComment (default fallback, no classify override)', () => {
    const source = '# a comment\nkey = "value"\n';
    const tree = parser.parse(source)!;
    const [region] = discoverRegions(tomlAdapter, tree, source, 'toml');
    expect(region!.kind).toBe('lineComment');
  });

  it('classifies a trailing # comment as lineComment too', () => {
    const source = 'key = "value" # trailing\n';
    const tree = parser.parse(source)!;
    const [region] = discoverRegions(tomlAdapter, tree, source, 'toml');
    expect(region!.kind).toBe('lineComment');
  });

  it('does not merge two adjacent # lines into one region', () => {
    const source = '# first\n# second\nkey = 1\n';
    const tree = parser.parse(source)!;
    const regions = discoverRegions(tomlAdapter, tree, source, 'toml');
    expect(regions).toHaveLength(2);
  });

  it('discovers nothing else besides comments -- no string-literal region kind exists here', () => {
    const source = 'key = "a plain TOML string value, never a wrappable region"\n';
    const tree = parser.parse(source)!;
    const regions = discoverRegions(tomlAdapter, tree, source, 'toml');
    expect(regions).toEqual([]);
  });
});
