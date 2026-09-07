import { Parser, Language, Query } from 'web-tree-sitter';
import { beforeAll, describe, expect, it } from 'vitest';
import { validateDescriptor } from '../../adapter-registry.js';
import { powershellDescriptor } from './descriptor.js';

let language: Language;

beforeAll(async () => {
  await Parser.init();
  language = await Language.load('grammars/tree-sitter-powershell.wasm');
});

describe('powershellDescriptor', () => {
  it('passes structural validation', () => {
    expect(() => validateDescriptor(powershellDescriptor)).not.toThrow();
  });

  it('declares a comments query that compiles against its own vendored grammar', () => {
    expect(() => new Query(language, powershellDescriptor.queries.comments!)).not.toThrow();
  });

  it('declares no strings/queries.strings at all', () => {
    expect(powershellDescriptor.strings).toBeUndefined();
    expect(powershellDescriptor.queries.strings).toBeUndefined();
  });

  it('declares the commentBasedHelp dialect (falling back to plain), with no plainBlock override', () => {
    expect(powershellDescriptor.comments.doc).toEqual({
      markers: ['<#'],
      dialects: ['commentBasedHelp', 'plain'],
    });
    expect(powershellDescriptor.comments.plainBlock).toBeUndefined();
  });

  it('captures a # line comment, a plain <# #> block, and a comment-based-help block under one @comment capture — all one node type', () => {
    const parser = new Parser();
    parser.setLanguage(language);
    const source = '# line\n<# plain #>\n<#\n.SYNOPSIS\nx\n#>\nWrite-Host "hi"\n';
    const tree = parser.parse(source)!;
    const query = new Query(language, powershellDescriptor.queries.comments!);
    const matches = query.matches(tree.rootNode);
    const nodeTypes = matches.flatMap((m) => m.captures.map((c) => c.node.type));
    expect(nodeTypes).toEqual(['comment', 'comment', 'comment']);
  });

  it('flags #Requires, #region/#endregion, and a shebang as never-reflow', () => {
    const patterns = powershellDescriptor.comments.neverReflow;
    const matches = (text: string): boolean => patterns.some((re) => re.test(text));

    expect(matches('#!/usr/bin/env pwsh')).toBe(true);
    expect(matches('#Requires -Version 7')).toBe(true);
    expect(matches('#region Helpers')).toBe(true);
    expect(matches('#endregion')).toBe(true);
    expect(matches('# just a regular comment')).toBe(false);
  });

  it('grammar loads and reports an ABI compatible with the pinned web-tree-sitter version', () => {
    expect(language.abiVersion).toBeGreaterThanOrEqual(13);
    expect(language.abiVersion).toBeLessThanOrEqual(15);
  });
});
