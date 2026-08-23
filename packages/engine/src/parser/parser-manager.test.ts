import { Language } from 'web-tree-sitter';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdapterRegistry } from '../adapter-registry.js';
import type { LanguageAdapter, LanguageDescriptor } from '../types/adapter.js';
import { ParserManager } from './parser-manager.js';

// `.` resolves against the process's cwd, which Vitest sets to this
// package's root (`packages/engine`) — so `wasmDir` plus a descriptor's
// `grammars/...` path resolves to the vendored asset, matching how
// `LanguageDescriptor.grammarWasm` fixtures are written elsewhere in this
// package (see `adapter-registry.test.ts`). No `node:url`/
// `import.meta.url`: this package's tests avoid depending on
// `@types/node` (see `../types/position-mapper.test.ts`).
const engineRoot = '.';

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
      neverReflow: [],
    },
    strings: {
      quotes: [{ delimiter: '"', multiline: false, escapes: true }],
      prefixes: [],
      rawForms: [],
      escapes: { sequences: [] },
      placeholders: [],
      concatenation: { style: 'implicit' },
    },
    ...overrides,
  };
}

function makeAdapter(overrides: Partial<LanguageDescriptor> = {}): LanguageAdapter {
  return { descriptor: makeDescriptor(overrides) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ParserManager', () => {
  it('returns a parser that can successfully parse source for a registered language', async () => {
    const registry = new AdapterRegistry();
    registry.register(makeAdapter());
    const manager = await ParserManager.create({ wasmDir: engineRoot, registry });

    const parser = await manager.parserFor('python');
    const tree = parser.parse('x = 1\n');

    expect(tree?.rootNode.type).toBe('module');
    expect(tree?.rootNode.hasError).toBe(false);
  });

  it('throws, naming the language, when no adapter is registered for it', async () => {
    const registry = new AdapterRegistry();
    const manager = await ParserManager.create({ wasmDir: engineRoot, registry });

    await expect(manager.parserFor('cobol')).rejects.toThrow(/'cobol'/);
  });

  it('loads a grammar once and reuses it across repeated resolutions', async () => {
    const loadSpy = vi.spyOn(Language, 'load');
    const registry = new AdapterRegistry();
    registry.register(makeAdapter());
    const manager = await ParserManager.create({ wasmDir: engineRoot, registry });

    await manager.parserFor('python');
    await manager.parserFor('python');

    expect(loadSpy).toHaveBeenCalledTimes(1);
  });

  it('loads a grammar once and reuses it when resolved through an alias', async () => {
    const loadSpy = vi.spyOn(Language, 'load');
    const registry = new AdapterRegistry();
    registry.register(makeAdapter({ id: 'python', aliases: ['python3'] }));
    const manager = await ParserManager.create({ wasmDir: engineRoot, registry });

    await manager.parserFor('python');
    await manager.parserFor('python3');

    expect(loadSpy).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight load across concurrent first-time requests', async () => {
    const loadSpy = vi.spyOn(Language, 'load');
    const registry = new AdapterRegistry();
    registry.register(makeAdapter());
    const manager = await ParserManager.create({ wasmDir: engineRoot, registry });

    const [parserA, parserB] = await Promise.all([
      manager.parserFor('python'),
      manager.parserFor('python'),
    ]);

    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(parserA.language).not.toBeNull();
    expect(parserB.language).not.toBeNull();
  });

  it('loads independently registered languages separately', async () => {
    const loadSpy = vi.spyOn(Language, 'load');
    const registry = new AdapterRegistry();
    registry.register(makeAdapter({ id: 'python' }));
    // Reuses the vendored Python grammar under a second synthetic id —
    // there's no second grammar vendored yet (that's Phase 6b's canary
    // JS adapter), but this is enough to prove distinct descriptor ids
    // are cached, and therefore loaded, independently of one another.
    registry.register(makeAdapter({ id: 'python-again' }));
    const manager = await ParserManager.create({ wasmDir: engineRoot, registry });

    await manager.parserFor('python');
    await manager.parserFor('python-again');

    expect(loadSpy).toHaveBeenCalledTimes(2);
  });
});
