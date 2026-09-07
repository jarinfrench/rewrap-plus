import { Parser, Language, Query } from 'web-tree-sitter';
import { beforeAll, describe, expect, it } from 'vitest';
import { validateDescriptor } from '../../adapter-registry.js';
import { cssDescriptor } from './descriptor.js';

let language: Language;

beforeAll(async () => {
  await Parser.init();
  language = await Language.load('grammars/tree-sitter-css.wasm');
});

describe('cssDescriptor', () => {
  it('passes structural validation', () => {
    expect(() => validateDescriptor(cssDescriptor)).not.toThrow();
  });

  it('declares a comments query that compiles against its own vendored grammar', () => {
    expect(() => new Query(language, cssDescriptor.queries.comments!)).not.toThrow();
  });

  it('declares no strings/queries.strings at all', () => {
    expect(cssDescriptor.strings).toBeUndefined();
    expect(cssDescriptor.queries.strings).toBeUndefined();
  });

  it('declares no line-comment form — CSS has no // syntax', () => {
    expect(cssDescriptor.comments.line).toBeUndefined();
  });

  it('declares a /* rewrap: off */-style directive marker, since there is no line marker to fall back to', () => {
    expect(cssDescriptor.directives).toEqual({ marker: '/*' });
  });

  it('captures a standalone and a trailing comment under one @comment capture', () => {
    const parser = new Parser();
    parser.setLanguage(language);
    const source = '/* standalone */\n.foo { color: red; /* trailing */ }\n';
    const tree = parser.parse(source)!;
    const query = new Query(language, cssDescriptor.queries.comments!);
    const matches = query.matches(tree.rootNode);
    const texts = matches.flatMap((m) => m.captures.map((c) => c.node.text));
    expect(texts).toEqual(['/* standalone */', '/* trailing */']);
  });

  it('grammar loads and reports an ABI compatible with the pinned web-tree-sitter version', () => {
    expect(language.abiVersion).toBeGreaterThanOrEqual(13);
    expect(language.abiVersion).toBeLessThanOrEqual(15);
  });
});
