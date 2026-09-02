import { describe, expect, it } from 'vitest';
import type { LanguageAdapter, LanguageDescriptor } from './types/adapter.js';
import { AdapterRegistry, validateDescriptor } from './adapter-registry.js';

function makeDescriptor(overrides: Partial<LanguageDescriptor> = {}): LanguageDescriptor {
  return {
    id: 'python',
    grammarWasm: 'grammars/tree-sitter-python.wasm',
    queries: {
      comments: '(comment) @comment',
      strings: '(string) @string',
    },
    comments: {
      line: { marker: '#', spaceAfter: true },
      neverReflow: [/^#\s*noqa\b/],
    },
    strings: {
      quotes: [
        { delimiter: '"', multiline: false, escapes: true },
        { delimiter: "'''", multiline: true, escapes: true },
      ],
      prefixes: [{ prefix: 'r', raw: true }],
      rawForms: [],
      escapes: { sequences: [/\\n/, /\\t/] },
      placeholders: [/\{[^{}]*\}/],
      concatenation: { style: 'implicit', requiresGrouping: true },
    },
    ...overrides,
  };
}

function makeAdapter(overrides: Partial<LanguageDescriptor> = {}): LanguageAdapter {
  return { descriptor: makeDescriptor(overrides) };
}

describe('validateDescriptor', () => {
  it('accepts a well-formed descriptor', () => {
    expect(() => validateDescriptor(makeDescriptor())).not.toThrow();
  });

  it('rejects an empty id', () => {
    expect(() => validateDescriptor(makeDescriptor({ id: '' }))).toThrow(/missing id/);
  });

  it('rejects a blank comment line marker, naming the descriptor id', () => {
    expect(() =>
      validateDescriptor(
        makeDescriptor({
          comments: { line: { marker: '   ', spaceAfter: true }, neverReflow: [] },
        }),
      ),
    ).toThrow(/'python'.*comments\.line\.marker/s);
  });

  it('rejects an empty strings.quotes list', () => {
    expect(() =>
      validateDescriptor(
        makeDescriptor({
          strings: {
            quotes: [],
            prefixes: [],
            rawForms: [],
            escapes: { sequences: [] },
            placeholders: [],
            concatenation: { style: 'implicit' },
          },
        }),
      ),
    ).toThrow(/strings\.quotes/);
  });

  it('rejects operator-style concatenation with no operator given', () => {
    expect(() =>
      validateDescriptor(
        makeDescriptor({
          strings: {
            quotes: [{ delimiter: '"', multiline: false, escapes: true }],
            prefixes: [],
            rawForms: [],
            escapes: { sequences: [] },
            placeholders: [],
            concatenation: { style: 'operator' },
          },
        }),
      ),
    ).toThrow(/concatenation\.operator/);
  });

  it('accepts a prose-shaped descriptor with no comments/strings queries and no strings block', () => {
    // The Markdown shape (`docs/planning/markdown-latex-plan.md` §5.1) —
    // built as a full literal, not through `makeDescriptor`'s override
    // merge, since `exactOptionalPropertyTypes` distinguishes an omitted
    // `strings` key from one explicitly set to `undefined`.
    const descriptor: LanguageDescriptor = {
      id: 'markdown-probe',
      grammarWasm: 'grammars/tree-sitter-markdown.wasm',
      queries: { prose: '(paragraph) @prose' },
      comments: { neverReflow: [] },
    };

    expect(() => validateDescriptor(descriptor)).not.toThrow();
  });

  it('rejects a descriptor that declares none of queries.comments/strings/prose and has no discoverProse hook', () => {
    const descriptor: LanguageDescriptor = {
      id: 'nothing-probe',
      grammarWasm: 'grammars/tree-sitter-markdown.wasm',
      queries: {},
      comments: { neverReflow: [] },
    };

    expect(() => validateDescriptor(descriptor)).toThrow(/discover nothing/);
  });

  it('accepts a descriptor with no queries at all when hasDiscoverProse is true', () => {
    // The LaTeX shape (`docs/planning/markdown-latex-plan.md` §6.2): prose
    // discovery is a masked line scan, not a query, so `queries.prose`
    // itself can be absent too — only the `discoverProse` hook's
    // *presence*, passed by the caller (normally `AdapterRegistry.register`,
    // which has the adapter in hand), satisfies the "discovers something"
    // requirement.
    const descriptor: LanguageDescriptor = {
      id: 'latex-probe',
      grammarWasm: 'grammars/tree-sitter-latex.wasm',
      queries: {},
      comments: { neverReflow: [] },
    };

    expect(() => validateDescriptor(descriptor, true)).not.toThrow();
  });

  it('rejects queries.strings declared without a strings block', () => {
    const descriptor: LanguageDescriptor = {
      id: 'mismatched-probe',
      grammarWasm: 'grammars/tree-sitter-python.wasm',
      queries: { strings: '(string) @string' },
      comments: { neverReflow: [] },
    };

    expect(() => validateDescriptor(descriptor)).toThrow(/queries\.strings and strings/);
  });

  it('rejects a strings block declared without queries.strings', () => {
    const descriptor: LanguageDescriptor = {
      id: 'mismatched-probe',
      grammarWasm: 'grammars/tree-sitter-python.wasm',
      queries: { comments: '(comment) @comment' },
      comments: { neverReflow: [] },
      strings: {
        quotes: [{ delimiter: '"', multiline: false, escapes: true }],
        prefixes: [],
        rawForms: [],
        escapes: { sequences: [] },
        placeholders: [],
        concatenation: { style: 'implicit' },
      },
    };

    expect(() => validateDescriptor(descriptor)).toThrow(/queries\.strings and strings/);
  });
});

describe('AdapterRegistry', () => {
  it('registers and resolves an adapter by its primary id', () => {
    const registry = new AdapterRegistry();
    const adapter = makeAdapter();

    registry.register(adapter);

    expect(registry.resolve('python')).toBe(adapter);
    expect(registry.resolve('nonexistent')).toBeUndefined();
  });

  it('resolves an adapter by any of its aliases', () => {
    const registry = new AdapterRegistry();
    const adapter = makeAdapter({ id: 'typescript', aliases: ['typescriptreact'] });

    registry.register(adapter);

    expect(registry.resolve('typescriptreact')).toBe(adapter);
  });

  it('lists every registered id, sorted, primary ids and aliases alike', () => {
    // `apply-wrap.ts`/`format-on-save.ts` both gate on this list
    // including a real, resolvable alias — see `./adapter-registry.ts`'s
    // own doc comment on `supportedLanguages` for the bug this test would
    // otherwise have kept pinned.
    const registry = new AdapterRegistry();
    registry.register(makeAdapter({ id: 'typescript', aliases: ['typescriptreact'] }));
    registry.register(makeAdapter({ id: 'python' }));

    expect(registry.supportedLanguages()).toEqual(['python', 'typescript', 'typescriptreact']);
  });

  it('refuses to register a second adapter under an id already taken', () => {
    const registry = new AdapterRegistry();
    registry.register(makeAdapter({ id: 'python' }));

    expect(() => registry.register(makeAdapter({ id: 'python' }))).toThrow(
      /already registered by 'python'/,
    );
  });

  it('refuses to register a second adapter under an alias already taken', () => {
    const registry = new AdapterRegistry();
    registry.register(makeAdapter({ id: 'typescript', aliases: ['tsx'] }));

    expect(() => registry.register(makeAdapter({ id: 'other', aliases: ['tsx'] }))).toThrow(
      /'tsx' is already registered by 'typescript'/,
    );
  });

  it('validates before registering, so a malformed descriptor never gets stored', () => {
    const registry = new AdapterRegistry();

    expect(() => registry.register(makeAdapter({ strings: undefined as never }))).toThrow();
    expect(registry.supportedLanguages()).toEqual([]);
  });
});
