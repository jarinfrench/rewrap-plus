import { Parser, Language } from 'web-tree-sitter';
import { beforeAll, describe, expect, it } from 'vitest';
import { discoverRegions } from '../../discovery/discover-regions.js';
import { shellscriptAdapter } from './adapter.js';

let parser: Parser;

beforeAll(async () => {
  await Parser.init();
  parser = new Parser();
  parser.setLanguage(await Language.load('grammars/tree-sitter-bash.wasm'));
});

describe('shellscriptAdapter', () => {
  it('classifies a standalone # comment as lineComment (default fallback, no classify override)', () => {
    const source = '# a comment\necho "hi"\n';
    const tree = parser.parse(source)!;
    const [region] = discoverRegions(shellscriptAdapter, tree, source, 'shellscript');
    expect(region!.kind).toBe('lineComment');
  });

  it('classifies the shebang line as lineComment too (still discovered, just never reflowed)', () => {
    const source = '#!/bin/bash\necho "hi"\n';
    const tree = parser.parse(source)!;
    const [region] = discoverRegions(shellscriptAdapter, tree, source, 'shellscript');
    expect(region!.kind).toBe('lineComment');
  });

  it('does not merge two adjacent # lines into one region', () => {
    const source = '# first\n# second\necho hi\n';
    const tree = parser.parse(source)!;
    const regions = discoverRegions(shellscriptAdapter, tree, source, 'shellscript');
    expect(regions).toHaveLength(2);
  });

  it('discovers nothing else besides comments', () => {
    const source = 'echo "a plain shell string value, never a wrappable region"\n';
    const tree = parser.parse(source)!;
    const regions = discoverRegions(shellscriptAdapter, tree, source, 'shellscript');
    expect(regions).toEqual([]);
  });
});
