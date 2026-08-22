import { describe, expect, it } from 'vitest';
import type { LanguageAdapter, LanguageDescriptor } from './adapter.js';

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

    expect(
      adapter.classify?.(
        {
          type: 'string',
          startIndex: 0,
          endIndex: 3,
          startPosition: { row: 0, column: 0 },
          endPosition: { row: 0, column: 3 },
          parent: null,
          children: [],
          text: '"x"',
        },
        '"x"',
      ),
    ).toBe('docstring');
  });
});
