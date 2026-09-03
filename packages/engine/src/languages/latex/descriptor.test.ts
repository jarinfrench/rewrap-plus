import { Parser, Language, Query } from 'web-tree-sitter';
import { beforeAll, describe, expect, it } from 'vitest';
import { validateDescriptor } from '../../adapter-registry.js';
import { latexDescriptor } from './descriptor.js';

const grammarPath = 'grammars/tree-sitter-latex.wasm';

let language: Language;

beforeAll(async () => {
  await Parser.init();
  language = await Language.load(grammarPath);
});

describe('latexDescriptor', () => {
  it('passes structural validation', () => {
    expect(() => validateDescriptor(latexDescriptor)).not.toThrow();
  });

  it('declares a comments query that compiles against the vendored grammar', () => {
    expect(() => new Query(language, latexDescriptor.queries.comments!)).not.toThrow();
  });

  it('captures line_comment nodes and nothing else', () => {
    const source = '% a comment\ntext \\% not a comment, 100\\% done\n';
    const parser = new Parser();
    parser.setLanguage(language);
    const parsed = parser.parse(source)!;
    const query = new Query(language, latexDescriptor.queries.comments!);
    const captures = query.captures(parsed.rootNode);
    expect(captures).toHaveLength(1);
    expect(captures[0]!.node.type).toBe('line_comment');
    expect(source.slice(captures[0]!.node.startIndex, captures[0]!.node.endIndex)).toBe('% a comment');
  });

  it('declares no string support — LaTeX has no string-literal syntax', () => {
    expect(latexDescriptor.strings).toBeUndefined();
    expect(latexDescriptor.queries.strings).toBeUndefined();
  });

  it('declares no prose query yet — discoverProse lands in a later commit', () => {
    expect(latexDescriptor.queries.prose).toBeUndefined();
  });

  it('uses % as the line-comment marker with a space after', () => {
    expect(latexDescriptor.comments.line).toEqual({ marker: '%', spaceAfter: true });
  });

  it('has no block-comment form declared — \\iffalse...\\fi is a discoverProse mask, not a queries.comments capture', () => {
    expect(latexDescriptor.comments.block).toBeUndefined();
    expect(latexDescriptor.comments.plainBlock).toBeUndefined();
  });

  it('flags TeX magic comments and %%-banner lines as never-reflow', () => {
    const patterns = latexDescriptor.comments.neverReflow;
    const matches = (text: string): boolean => patterns.some((re) => re.test(text));

    expect(matches('%!TEX root = main.tex')).toBe(true);
    expect(matches('%! TeX program = xelatex')).toBe(true);
    expect(matches('%%%%%%%%%%%%%%%%')).toBe(true);
    expect(matches('% just a regular comment')).toBe(false);
    expect(matches('% Section banner')).toBe(false); // single %, not a banner rule itself
  });

  it('flags preamble/definition commands as code-like', () => {
    const pattern = latexDescriptor.comments.codeLikeKeywords;
    expect(pattern).toBeDefined();
    const matches = (text: string): boolean => pattern!.test(text);

    expect(matches('\\documentclass{article}')).toBe(true);
    expect(matches('\\usepackage{amsmath}')).toBe(true);
    expect(matches('\\newcommand{\\foo}{bar}')).toBe(true);
    expect(matches('\\section{Old title}')).toBe(false); // not in the keyword list itself
    expect(matches('This is an ordinary sentence.')).toBe(false);
  });
});
