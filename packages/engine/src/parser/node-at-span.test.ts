import { Parser, Language } from 'web-tree-sitter';
import { beforeAll, describe, expect, it } from 'vitest';
import { discoverRegions } from '../discovery/discover-regions.js';
import { pythonAdapter } from '../languages/python/adapter.js';
import { nodeAtSpan } from './node-at-span.js';

const grammarPath = 'grammars/tree-sitter-python.wasm';

let parser: Parser;

beforeAll(async () => {
  await Parser.init();
  const language = await Language.load(grammarPath);
  parser = new Parser();
  parser.setLanguage(language);
});

describe('nodeAtSpan', () => {
  it('re-finds a concatenated_string node from its region span', () => {
    const source = 'x = "a" "b"\n';
    const tree = parser.parse(source)!;
    const [region] = discoverRegions(pythonAdapter, tree, source, 'python');

    const node = nodeAtSpan(tree, region!.span);

    expect(node?.type).toBe('concatenated_string');
    expect(node?.text).toBe('"a" "b"');
  });

  it('re-finds a binary_operator (+) concatenation node from its region span', () => {
    const source = 'x = "a" + "b"\n';
    const tree = parser.parse(source)!;
    const [region] = discoverRegions(pythonAdapter, tree, source, 'python');

    const node = nodeAtSpan(tree, region!.span);

    expect(node?.type).toBe('binary_operator');
    expect(node?.text).toBe('"a" + "b"');
  });

  it('re-finds a lone string node from its region span', () => {
    const source = 'x = "hello"\n';
    const tree = parser.parse(source)!;
    const [region] = discoverRegions(pythonAdapter, tree, source, 'python');

    const node = nodeAtSpan(tree, region!.span);

    expect(node?.type).toBe('string');
    expect(node?.text).toBe('"hello"');
  });

  it('returns null for a span with no matching node (descendantForPosition clamps to root instead)', () => {
    const source = 'x = 1\n';
    const tree = parser.parse(source)!;

    const node = nodeAtSpan(tree, {
      startByte: 100,
      endByte: 110,
      startRow: 50,
      startColumn: 0,
      endRow: 50,
      endColumn: 10,
    });

    expect(node).toBeNull();
  });
});
