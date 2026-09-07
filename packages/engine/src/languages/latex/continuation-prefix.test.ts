import { describe, expect, it } from 'vitest';
import { latexContinuationPrefix } from './continuation-prefix.js';

describe('latexContinuationPrefix', () => {
  it('returns empty for an ordinary paragraph with no leading indentation', () => {
    expect(latexContinuationPrefix('This is ordinary text.')).toBe('');
  });

  it('returns the leading spaces for an indented ordinary line', () => {
    expect(latexContinuationPrefix('    Indented paragraph text.')).toBe('    ');
  });

  it('stops at \\item, not at the item text -- the plan\'s own worked example', () => {
    expect(latexContinuationPrefix('  \\item Long text that needs wrapping.')).toBe('  ');
  });

  it('stops at a labeled \\item, not past the [label]', () => {
    expect(latexContinuationPrefix('  \\item[custom] Labeled item text.')).toBe('  ');
  });

  it('preserves a literal leading tab rather than expanding it', () => {
    expect(latexContinuationPrefix('\t\\item Tab-indented item.')).toBe('\t');
  });

  it('returns the whole string when the line is entirely whitespace', () => {
    expect(latexContinuationPrefix('    ')).toBe('    ');
  });

  it('returns empty for an empty string', () => {
    expect(latexContinuationPrefix('')).toBe('');
  });
});
