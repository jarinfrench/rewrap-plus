import { Parser, Language, Query } from 'web-tree-sitter';
import { beforeAll, describe, expect, it } from 'vitest';
import { validateDescriptor } from '../../adapter-registry.js';
import { scssDescriptor } from './descriptor.js';

let language: Language;

beforeAll(async () => {
  await Parser.init();
  language = await Language.load('grammars/tree-sitter-scss.wasm');
});

describe('scssDescriptor', () => {
  it('passes structural validation', () => {
    expect(() => validateDescriptor(scssDescriptor)).not.toThrow();
  });

  it('declares a comments query that compiles against its own vendored grammar', () => {
    expect(() => new Query(language, scssDescriptor.queries.comments!)).not.toThrow();
  });

  it('declares no strings/queries.strings at all', () => {
    expect(scssDescriptor.strings).toBeUndefined();
    expect(scssDescriptor.queries.strings).toBeUndefined();
  });

  it('captures both js_comment (//) and comment (/* */) nodes under one @comment capture', () => {
    const parser = new Parser();
    parser.setLanguage(language);
    const source = '// line\n/* block */\n.foo { color: red; }\n';
    const tree = parser.parse(source)!;
    const query = new Query(language, scssDescriptor.queries.comments!);
    const matches = query.matches(tree.rootNode);
    const captured = matches.flatMap((m) => m.captures.map((c) => ({ type: c.node.type, text: c.node.text })));
    expect(captured).toEqual([
      { type: 'js_comment', text: '// line' },
      { type: 'comment', text: '/* block */' },
    ]);
  });

  it('grammar loads and reports an ABI compatible with the pinned web-tree-sitter version', () => {
    expect(language.abiVersion).toBeGreaterThanOrEqual(13);
    expect(language.abiVersion).toBeLessThanOrEqual(15);
  });
});
