import { describe, expect, it } from 'vitest';
import { detectLanguageFromPath, knownExtensions } from './language-detection.js';

describe('detectLanguageFromPath', () => {
  it.each([
    ['a/b/script.py', 'python'],
    ['script.PYI', 'python'],
    ['src/app.js', 'javascript'],
    ['src/app.mjs', 'javascript'],
    ['src/app.cjs', 'javascript'],
    ['src/App.jsx', 'javascriptreact'],
    ['src/app.ts', 'typescript'],
    ['src/app.mts', 'typescript'],
    ['src/app.cts', 'typescript'],
    ['src/App.tsx', 'typescriptreact'],
    ['lib/thing.cpp', 'cpp'],
    ['lib/thing.cc', 'cpp'],
    ['lib/thing.cxx', 'cpp'],
    ['lib/thing.c++', 'cpp'],
    ['lib/thing.hpp', 'cpp'],
    ['lib/thing.hh', 'cpp'],
    ['lib/thing.hxx', 'cpp'],
    ['lib/thing.h++', 'cpp'],
    ['lib/thing.h', 'cpp'],
    ['src/Greeter.java', 'java'],
  ])('detects %s as %s', (path, expected) => {
    expect(detectLanguageFromPath(path)).toBe(expected);
  });

  it('does not treat a second dot-segment as part of the extension', () => {
    expect(detectLanguageFromPath('src/component.test.ts')).toBe('typescript');
    expect(detectLanguageFromPath('src/component.spec.tsx')).toBe('typescriptreact');
  });

  it('returns undefined for unknown extensions', () => {
    expect(detectLanguageFromPath('README.md')).toBeUndefined();
    expect(detectLanguageFromPath('data.json')).toBeUndefined();
  });

  it('returns undefined for a path with no extension', () => {
    expect(detectLanguageFromPath('Makefile')).toBeUndefined();
    expect(detectLanguageFromPath('src/noext')).toBeUndefined();
  });
});

describe('knownExtensions', () => {
  it('includes every extension the detection table maps', () => {
    const extensions = knownExtensions();
    expect(extensions).toContain('.py');
    expect(extensions).toContain('.tsx');
    expect(extensions).toContain('.cpp');
    expect(new Set(extensions).size).toBe(extensions.length);
  });
});
