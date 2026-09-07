import { Parser, Language } from 'web-tree-sitter';
import { beforeAll, describe, expect, it } from 'vitest';
import { discoverRegions } from '../../discovery/discover-regions.js';
import { cssAdapter } from './adapter.js';

let parser: Parser;

beforeAll(async () => {
  await Parser.init();
  parser = new Parser();
  parser.setLanguage(await Language.load('grammars/tree-sitter-css.wasm'));
});

describe('cssAdapter', () => {
  it('classifies a /* */ comment as blockComment (CSS has no line-comment form to default to)', () => {
    const source = '/* a comment */\n.foo { color: red; }\n';
    const tree = parser.parse(source)!;
    const [region] = discoverRegions(cssAdapter, tree, source, 'css');
    expect(region!.kind).toBe('blockComment');
  });

  it('classifies a trailing comment inside a rule block as blockComment too', () => {
    const source = '.foo { color: red; /* trailing */ }\n';
    const tree = parser.parse(source)!;
    const [region] = discoverRegions(cssAdapter, tree, source, 'css');
    expect(region!.kind).toBe('blockComment');
  });

  it('discovers nothing else besides comments', () => {
    const source = '.foo { content: "a plain CSS string value, never a wrappable region"; }\n';
    const tree = parser.parse(source)!;
    const regions = discoverRegions(cssAdapter, tree, source, 'css');
    expect(regions).toEqual([]);
  });
});
