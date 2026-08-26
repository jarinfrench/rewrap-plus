import { Parser, Language, Query } from 'web-tree-sitter';
import { beforeAll, describe, expect, it } from 'vitest';
import { validateDescriptor } from '../../adapter-registry.js';
import { cppDescriptor } from './descriptor.js';

let language: Language;

beforeAll(async () => {
  await Parser.init();
  language = await Language.load('grammars/tree-sitter-cpp.wasm');
});

describe('cppDescriptor', () => {
  it('passes structural validation', () => {
    expect(() => validateDescriptor(cppDescriptor)).not.toThrow();
  });

  it('declares queries that compile against its own vendored grammar', () => {
    expect(() => new Query(language, cppDescriptor.queries.comments)).not.toThrow();
    expect(() => new Query(language, cppDescriptor.queries.strings)).not.toThrow();
    expect(() => new Query(language, cppDescriptor.queries.concatenations!)).not.toThrow();
  });

  it('declares the doxygen dialect (falling back to plain) for both doc-comment forms', () => {
    expect(cppDescriptor.comments.doc).toEqual({
      markers: ['/**', '///'],
      dialects: ['doxygen', 'plain'],
      repeatedMarker: '///',
    });
  });

  it('declares implicit (bare-adjacency) concatenation with no grouping requirement', () => {
    expect(cppDescriptor.strings.concatenation).toEqual({ style: 'implicit' });
  });

  it('declares only bare-adjacency concatenation, no + operator pattern', () => {
    // Unlike Python/JavaScript/TypeScript, `+` between two string
    // literals is not valid C++ concatenation syntax — see
    // `./descriptor.ts`'s own doc comment.
    expect(cppDescriptor.queries.concatenations).not.toMatch(/concat\.operator/);
  });

  it('declares only a double-quote form, no single-quote (char_literal is a separate node type)', () => {
    expect(cppDescriptor.strings.quotes).toEqual([{ delimiter: '"', multiline: false, escapes: true }]);
  });

  it('flags common C++ tooling directives as never-reflow', () => {
    const patterns = cppDescriptor.comments.neverReflow;
    const matches = (text: string): boolean => patterns.some((re) => re.test(text));

    expect(matches('// NOLINT(readability-magic-numbers)')).toBe(true);
    expect(matches('// clang-format off')).toBe(true);
    expect(matches('// cppcheck-suppress unusedVariable')).toBe(true);
    expect(matches('// just a regular comment')).toBe(false);
  });

  it('grammar loads and reports an ABI compatible with the pinned web-tree-sitter version', () => {
    expect(language.abiVersion).toBeGreaterThanOrEqual(13);
    expect(language.abiVersion).toBeLessThanOrEqual(15);
  });
});
