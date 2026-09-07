import { Parser, Language } from 'web-tree-sitter';
import { beforeAll, describe, expect, it } from 'vitest';
import { discoverRegions } from '../../discovery/discover-regions.js';
import { scssAdapter } from './adapter.js';

let parser: Parser;

beforeAll(async () => {
  await Parser.init();
  parser = new Parser();
  parser.setLanguage(await Language.load('grammars/tree-sitter-scss.wasm'));
});

describe('scssAdapter', () => {
  it('classifies a // comment as lineComment', () => {
    const source = '// a comment\n.foo { color: red; }\n';
    const tree = parser.parse(source)!;
    const [region] = discoverRegions(scssAdapter, tree, source, 'scss');
    expect(region!.kind).toBe('lineComment');
  });

  it('classifies a /* */ comment as blockComment', () => {
    const source = '/* a comment */\n.foo { color: red; }\n';
    const tree = parser.parse(source)!;
    const [region] = discoverRegions(scssAdapter, tree, source, 'scss');
    expect(region!.kind).toBe('blockComment');
  });

  it('discovers both comment forms together, each with its own kind', () => {
    const source = '// line\n/* block */\n.foo { color: red; }\n';
    const tree = parser.parse(source)!;
    const regions = discoverRegions(scssAdapter, tree, source, 'scss');
    expect(regions.map((r) => r.kind)).toEqual(['lineComment', 'blockComment']);
  });

  it('discovers nothing else besides comments', () => {
    const source = '.foo { content: "a plain SCSS string value, never a wrappable region"; }\n';
    const tree = parser.parse(source)!;
    const regions = discoverRegions(scssAdapter, tree, source, 'scss');
    expect(regions).toEqual([]);
  });
});
