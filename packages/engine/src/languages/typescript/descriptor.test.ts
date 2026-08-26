import { Parser, Language, Query } from 'web-tree-sitter';
import { beforeAll, describe, expect, it } from 'vitest';
import { validateDescriptor } from '../../adapter-registry.js';
import { typescriptDescriptor, typescriptReactDescriptor } from './descriptor.js';

let tsLanguage: Language;
let tsxLanguage: Language;

beforeAll(async () => {
  await Parser.init();
  tsLanguage = await Language.load('grammars/tree-sitter-typescript.wasm');
  tsxLanguage = await Language.load('grammars/tree-sitter-tsx.wasm');
});

describe.each([
  ['typescriptDescriptor', () => typescriptDescriptor, () => tsLanguage] as const,
  ['typescriptReactDescriptor', () => typescriptReactDescriptor, () => tsxLanguage] as const,
])('%s', (_name, getDescriptor, getLanguage) => {
  it('passes structural validation', () => {
    expect(() => validateDescriptor(getDescriptor())).not.toThrow();
  });

  it('declares queries that compile against its own vendored grammar', () => {
    const descriptor = getDescriptor();
    const language = getLanguage();
    expect(() => new Query(language, descriptor.queries.comments)).not.toThrow();
    expect(() => new Query(language, descriptor.queries.strings)).not.toThrow();
    expect(() => new Query(language, descriptor.queries.concatenations!)).not.toThrow();
  });

  it('declares the jsdoc dialect (falling back to plain) for doc comments', () => {
    expect(getDescriptor().comments.doc).toEqual({ markers: ['/**'], dialects: ['jsdoc', 'plain'] });
  });

  it('declares operator-style concatenation with no grouping requirement', () => {
    expect(getDescriptor().strings.concatenation).toEqual({
      style: 'operator',
      operator: '+',
      operatorPlacement: 'trailing',
    });
  });

  it('flags common tooling directives as never-reflow', () => {
    const patterns = getDescriptor().comments.neverReflow;
    const matches = (text: string): boolean => patterns.some((re) => re.test(text));

    expect(matches('// eslint-disable-next-line no-console')).toBe(true);
    expect(matches('// @ts-expect-error')).toBe(true);
    expect(matches('// just a regular comment')).toBe(false);
  });

  it('grammar loads and reports an ABI compatible with the pinned web-tree-sitter version', () => {
    const language = getLanguage();
    expect(language.abiVersion).toBeGreaterThanOrEqual(13);
    expect(language.abiVersion).toBeLessThanOrEqual(15);
  });
});

describe('typescriptDescriptor vs typescriptReactDescriptor', () => {
  it('are separate descriptors pointing at separate grammar files, not an alias pair', () => {
    expect(typescriptDescriptor.id).toBe('typescript');
    expect(typescriptReactDescriptor.id).toBe('typescriptreact');
    expect(typescriptDescriptor.grammarWasm).not.toBe(typescriptReactDescriptor.grammarWasm);
    expect(typescriptDescriptor.aliases).toBeUndefined();
    expect(typescriptReactDescriptor.aliases).toBeUndefined();
  });

  it('share identical comment/string/concatenation data otherwise', () => {
    expect(typescriptDescriptor.comments).toEqual(typescriptReactDescriptor.comments);
    expect(typescriptDescriptor.strings).toEqual(typescriptReactDescriptor.strings);
    expect(typescriptDescriptor.queries).toEqual(typescriptReactDescriptor.queries);
  });
});
