import { Parser, Language, Query } from 'web-tree-sitter';
import { beforeAll, describe, expect, it } from 'vitest';
import { validateDescriptor } from '../../adapter-registry.js';
import { shellscriptDescriptor } from './descriptor.js';

let language: Language;

beforeAll(async () => {
  await Parser.init();
  language = await Language.load('grammars/tree-sitter-bash.wasm');
});

describe('shellscriptDescriptor', () => {
  it('passes structural validation', () => {
    expect(() => validateDescriptor(shellscriptDescriptor)).not.toThrow();
  });

  it('declares a comments query that compiles against its own vendored grammar', () => {
    expect(() => new Query(language, shellscriptDescriptor.queries.comments!)).not.toThrow();
  });

  it('declares no strings/queries.strings at all', () => {
    expect(shellscriptDescriptor.strings).toBeUndefined();
    expect(shellscriptDescriptor.queries.strings).toBeUndefined();
  });

  it('captures a shebang, a standalone comment, and a trailing comment under one @comment capture', () => {
    const parser = new Parser();
    parser.setLanguage(language);
    const source = '#!/bin/bash\n# standalone\necho "hi" # trailing\n';
    const tree = parser.parse(source)!;
    const query = new Query(language, shellscriptDescriptor.queries.comments!);
    const matches = query.matches(tree.rootNode);
    const texts = matches.flatMap((m) => m.captures.map((c) => c.node.text));
    expect(texts).toEqual(['#!/bin/bash', '# standalone', '# trailing']);
  });

  it('flags a shebang and a shellcheck directive as never-reflow', () => {
    const patterns = shellscriptDescriptor.comments.neverReflow;
    const matches = (text: string): boolean => patterns.some((re) => re.test(text));

    expect(matches('#!/bin/bash')).toBe(true);
    expect(matches('# shellcheck disable=SC2086')).toBe(true);
    expect(matches('# just a regular comment')).toBe(false);
  });

  it('grammar loads and reports an ABI compatible with the pinned web-tree-sitter version', () => {
    expect(language.abiVersion).toBeGreaterThanOrEqual(13);
    expect(language.abiVersion).toBeLessThanOrEqual(15);
  });
});
