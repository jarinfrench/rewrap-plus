import { describe, expect, it } from 'vitest';
import { isListContinuation, matchListMarker } from './list-item.js';

describe('matchListMarker', () => {
  it.each([
    ['-', '-'],
    ['*', '*'],
    ['+', '+'],
    ['•', '•'],
  ])('matches the %s bullet', (bullet) => {
    const match = matchListMarker(`${bullet} First item.`);
    expect(match?.marker).toBe(bullet);
    expect(match?.rest).toBe('First item.');
  });

  it('matches a digit-dot ordered marker', () => {
    const match = matchListMarker('1. First item.');
    expect(match?.marker).toBe('1.');
    expect(match?.rest).toBe('First item.');
  });

  it('matches a multi-digit ordered marker', () => {
    const match = matchListMarker('10. Tenth item.');
    expect(match?.marker).toBe('10.');
  });

  it('matches a digit-paren ordered marker', () => {
    const match = matchListMarker('1) First item.');
    expect(match?.marker).toBe('1)');
  });

  it('matches a single-letter ordered marker', () => {
    const match = matchListMarker('a. Lettered item.');
    expect(match?.marker).toBe('a.');
  });

  it('matches a single roman-numeral ordered marker', () => {
    const match = matchListMarker('i. Roman item.');
    expect(match?.marker).toBe('i.');
  });

  it('matches a multi-character roman-numeral ordered marker in full', () => {
    const match = matchListMarker('iv. Fourth item.');
    expect(match?.marker).toBe('iv.');
    expect(match?.rest).toBe('Fourth item.');
  });

  it('records leading indentation', () => {
    const match = matchListMarker('    - Indented item.');
    expect(match?.indent).toBe('    ');
  });

  it('computes hangingIndent as indent + marker + spacing', () => {
    const match = matchListMarker('  - Item.');
    // indent "  " (2) + marker "-" (1) + spacing " " (1) = 4
    expect(match?.hangingIndent).toBe(4);
  });

  it('computes hangingIndent with a wider ordered marker', () => {
    const match = matchListMarker('10)  Item.');
    // indent "" (0) + marker "10)" (3) + spacing "  " (2) = 5
    expect(match?.hangingIndent).toBe(5);
  });

  it('allows a marker with no trailing text (blank item)', () => {
    const match = matchListMarker('-');
    expect(match?.marker).toBe('-');
    expect(match?.rest).toBe('');
  });

  it('returns null for plain paragraph text', () => {
    expect(matchListMarker('Just a sentence.')).toBeNull();
  });

  it('returns null for a blank line', () => {
    expect(matchListMarker('')).toBeNull();
  });
});

describe('isListContinuation', () => {
  const item = matchListMarker('- First item.')!;

  it('accepts a further-indented non-marker line', () => {
    expect(isListContinuation('  continuation text', item)).toBe(true);
  });

  it('rejects a blank line', () => {
    expect(isListContinuation('', item)).toBe(false);
    expect(isListContinuation('   ', item)).toBe(false);
  });

  it('rejects a line at or shallower than the marker indent', () => {
    expect(isListContinuation('not indented', item)).toBe(false);
  });

  it('rejects a line that is itself a new list marker, even if indented', () => {
    expect(isListContinuation('  - nested-looking new item', item)).toBe(false);
  });
});
