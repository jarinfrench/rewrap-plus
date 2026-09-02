import { Parser, Language, Query } from 'web-tree-sitter';
import { beforeAll, describe, expect, it } from 'vitest';
import { validateDescriptor } from '../../adapter-registry.js';
import { javascriptDescriptor } from './descriptor.js';

const grammarPath = 'grammars/tree-sitter-javascript.wasm';

let language: Language;

beforeAll(async () => {
  await Parser.init();
  language = await Language.load(grammarPath);
});

describe('javascriptDescriptor', () => {
  it('passes structural validation', () => {
    expect(() => validateDescriptor(javascriptDescriptor)).not.toThrow();
  });

  it('declares queries that compile against the vendored grammar', () => {
    expect(() => new Query(language, javascriptDescriptor.queries.comments!)).not.toThrow();
    expect(() => new Query(language, javascriptDescriptor.queries.strings!)).not.toThrow();
  });

  it('declares a concatenation query for +-style string wrapping', () => {
    expect(javascriptDescriptor.queries.concatenations).toBe(
      '(binary_expression operator: "+") @concat.operator',
    );
    expect(() => new Query(language, javascriptDescriptor.queries.concatenations!)).not.toThrow();
  });

  it('declares a JSDoc-shaped block comment form', () => {
    const block = javascriptDescriptor.comments.block;
    expect(block).toEqual({
      open: '/**',
      close: '*/',
      continuationPrefix: '*',
      alignContinuation: 'open',
    });
  });

  it('declares the jsdoc dialect (falling back to plain) for doc comments', () => {
    expect(javascriptDescriptor.comments.doc).toEqual({
      markers: ['/**'],
      dialects: ['jsdoc', 'plain'],
    });
  });

  it('aliases javascriptreact to the same grammar', () => {
    expect(javascriptDescriptor.aliases).toEqual(['javascriptreact']);
  });

  it('flags common tooling directives as never-reflow', () => {
    const patterns = javascriptDescriptor.comments.neverReflow;
    const matches = (text: string): boolean => patterns.some((re) => re.test(text));

    expect(matches('// eslint-disable-next-line no-console')).toBe(true);
    expect(matches('// @ts-expect-error')).toBe(true);
    expect(matches('// @ts-ignore')).toBe(true);
    expect(matches('// prettier-ignore')).toBe(true);
    expect(matches('// istanbul ignore next')).toBe(true);
    expect(matches('// just a regular comment')).toBe(false);
  });

  it('grammar loads and reports an ABI compatible with the pinned web-tree-sitter version', () => {
    // Mirrors the Python descriptor's own implicit check (docs/parsing.md's
    // Finding 2): `Language.load` above would already have thrown if
    // the ABI were incompatible, but asserting the concrete number
    // keeps a future incompatible upgrade of either package visible in
    // a diff rather than only failing opaquely elsewhere.
    expect(language.abiVersion).toBeGreaterThanOrEqual(13);
    expect(language.abiVersion).toBeLessThanOrEqual(15);
  });
});
