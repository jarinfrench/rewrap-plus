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
    expect(() => new Query(language, javascriptDescriptor.queries.comments)).not.toThrow();
    expect(() => new Query(language, javascriptDescriptor.queries.strings)).not.toThrow();
  });

  it('declares no concatenation query — string wrapping is out of scope for this canary', () => {
    expect(javascriptDescriptor.queries.concatenations).toBeUndefined();
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

  it('declares no documentation dialects — out of scope for this canary', () => {
    expect(javascriptDescriptor.comments.doc).toBeUndefined();
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
    // Mirrors the Python descriptor's own implicit check (Phase 2,
    // finding 2): `Language.load` above would already have thrown if
    // the ABI were incompatible, but asserting the concrete number
    // keeps a future incompatible upgrade of either package visible in
    // a diff rather than only failing opaquely elsewhere.
    expect(language.abiVersion).toBeGreaterThanOrEqual(13);
    expect(language.abiVersion).toBeLessThanOrEqual(15);
  });
});
