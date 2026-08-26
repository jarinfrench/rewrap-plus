import { describe, expect, it } from 'vitest';
import { createDialectRegistry } from './registry.js';

describe('createDialectRegistry', () => {
  it('registers every dialect this package ships', () => {
    const registry = createDialectRegistry();
    expect(registry.resolve('plain')).toBeDefined();
    expect(registry.resolve('google')).toBeDefined();
    expect(registry.resolve('numpy')).toBeDefined();
    expect(registry.resolve('sphinx')).toBeDefined();
    expect(registry.resolve('jsdoc')).toBeDefined();
    expect(registry.resolve('doxygen')).toBeDefined();
  });

  it('detects google, numpy, and sphinx text correctly among all four candidates', () => {
    const registry = createDialectRegistry();
    const candidates = ['google', 'numpy', 'sphinx', 'plain'] as const;

    expect(registry.detectBest('Summary.\n\nArgs:\n    x: description', candidates)).toBe('google');
    expect(
      registry.detectBest('Summary.\n\nParameters\n----------\nx : int\n    desc', candidates),
    ).toBe('numpy');
    expect(registry.detectBest('Summary.\n\n:param x: description', candidates)).toBe('sphinx');
    expect(registry.detectBest('Just a plain summary with no structure.', candidates)).toBe('plain');
  });
});
