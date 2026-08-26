import { Parser, Language } from 'web-tree-sitter';
import { beforeAll, describe, expect, it } from 'vitest';
import type { LanguageAdapter, LanguageDescriptor } from './adapter.js';
import type { SyntaxNode } from './tree-sitter-types.js';

// `classify`'s `node` parameter is a real `web-tree-sitter` `Node` (see
// `./tree-sitter-types.ts`, which re-exports the genuine type — earlier
// in this package's history it stood in for a hand-rolled placeholder
// shape). `Node` is a class with many required members (`id`, `tree`,
// `typeId`, getters, ...), so a hand-written object literal can no
// longer stand in for one the way it could against that earlier
// placeholder interface. Parsing a one-line
// snippet with the vendored grammar to obtain a real node is only a
// little more setup and tests the hook against what it will actually
// receive in practice.
// Relative to the process's cwd, which Vitest sets to this package's root
// (`packages/engine`) — same convention as every other grammar-loading
// test in this package (see `parser/parser-manager.test.ts`). Avoids
// `node:url`/`import.meta.url`, which this package's tests don't type
// against (no `@types/node` dependency — see `position-mapper.test.ts`).
const grammarPath = 'grammars/tree-sitter-python.wasm';
let stringNode: SyntaxNode;

beforeAll(async () => {
  await Parser.init();
  const language = await Language.load(grammarPath);
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse('"x"');
  const found = tree?.rootNode.descendantsOfType('string')[0];
  if (!found) {
    throw new Error('test setup: expected a `string` node parsing `"x"`');
  }
  stringNode = found;
});

function minimalDescriptor(overrides: Partial<LanguageDescriptor> = {}): LanguageDescriptor {
  return {
    id: 'plaintext-probe',
    grammarWasm: 'grammars/plaintext-probe.wasm',
    queries: {
      comments: '(comment) @comment',
      strings: '(string) @string',
    },
    comments: {
      line: { marker: '#', spaceAfter: true },
      neverReflow: [/^#\s*noqa\b/],
    },
    strings: {
      quotes: [{ delimiter: '"', multiline: false, escapes: true }],
      prefixes: [],
      rawForms: [],
      escapes: { sequences: [/\\n/, /\\t/] },
      placeholders: [/\{[^{}]*\}/],
      concatenation: { style: 'implicit', requiresGrouping: true },
    },
    ...overrides,
  };
}

describe('LanguageDescriptor', () => {
  it('is pure data — a minimal descriptor needs no methods', () => {
    const descriptor = minimalDescriptor();

    expect(descriptor.id).toBe('plaintext-probe');
    expect(descriptor.comments.line?.marker).toBe('#');
    expect(descriptor.strings.quotes).toHaveLength(1);
  });

  it('supports operator-style concatenation with a placement setting', () => {
    const descriptor = minimalDescriptor({
      strings: {
        quotes: [{ delimiter: '"', multiline: false, escapes: true }],
        prefixes: [{ prefix: 'f', formatted: true }],
        rawForms: [{ open: 'R"(', close: ')"' }],
        escapes: { sequences: [/\\n/] },
        placeholders: [],
        concatenation: { style: 'operator', operator: '+', operatorPlacement: 'trailing' },
      },
    });

    expect(descriptor.strings.concatenation.style).toBe('operator');
    expect(descriptor.strings.rawForms[0]?.open).toBe('R"(');
  });
});

describe('LanguageAdapter', () => {
  it('is valid with only a descriptor — every hook is optional', () => {
    const adapter: LanguageAdapter = { descriptor: minimalDescriptor() };

    expect(adapter.classify).toBeUndefined();
    expect(adapter.descriptor.id).toBe('plaintext-probe');
  });

  it('allows overriding classify without implementing the other hooks', () => {
    const adapter: LanguageAdapter = {
      descriptor: minimalDescriptor(),
      classify: (node) => (node.type === 'string' ? 'docstring' : null),
    };

    expect(adapter.classify?.(stringNode, '"x"')).toBe('docstring');
  });
});
