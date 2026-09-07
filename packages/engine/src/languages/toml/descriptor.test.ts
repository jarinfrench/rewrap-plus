import { Parser, Language, Query } from 'web-tree-sitter';
import { beforeAll, describe, expect, it } from 'vitest';
import { validateDescriptor } from '../../adapter-registry.js';
import { tomlDescriptor } from './descriptor.js';

let language: Language;

beforeAll(async () => {
  await Parser.init();
  language = await Language.load('grammars/tree-sitter-toml.wasm');
});

describe('tomlDescriptor', () => {
  it('passes structural validation', () => {
    expect(() => validateDescriptor(tomlDescriptor)).not.toThrow();
  });

  it('declares a comments query that compiles against its own vendored grammar', () => {
    expect(() => new Query(language, tomlDescriptor.queries.comments!)).not.toThrow();
  });

  it('declares no strings/queries.strings at all', () => {
    expect(tomlDescriptor.strings).toBeUndefined();
    expect(tomlDescriptor.queries.strings).toBeUndefined();
  });

  it('captures both a standalone and a trailing comment under one @comment capture', () => {
    const parser = new Parser();
    parser.setLanguage(language);
    const source = '# standalone\nkey = "value" # trailing\n';
    const tree = parser.parse(source)!;
    const query = new Query(language, tomlDescriptor.queries.comments!);
    const matches = query.matches(tree.rootNode);
    const texts = matches.flatMap((m) => m.captures.map((c) => c.node.text));
    expect(texts).toEqual(['# standalone', '# trailing']);
  });

  it('grammar loads and reports an ABI compatible with the pinned web-tree-sitter version', () => {
    expect(language.abiVersion).toBeGreaterThanOrEqual(13);
    expect(language.abiVersion).toBeLessThanOrEqual(15);
  });
});
