import { describe, expect, it } from 'vitest';
import { extractPrefix } from './prefix.js';

describe('extractPrefix', () => {
  it('extracts an empty prefix from a plain string literal', () => {
    expect(extractPrefix('"plain"')).toBe('');
  });

  it('extracts the wide prefix L', () => {
    expect(extractPrefix('L"wide"')).toBe('L');
  });

  it('extracts the char16_t prefix u', () => {
    expect(extractPrefix('u"utf16"')).toBe('u');
  });

  it('extracts the char32_t prefix U', () => {
    expect(extractPrefix('U"utf32"')).toBe('U');
  });

  it('extracts the utf-8 prefix u8, not just u', () => {
    expect(extractPrefix('u8"utf8"')).toBe('u8');
  });

  it('is case-sensitive: lowercase l is not a recognized prefix', () => {
    expect(extractPrefix('l"not a real prefix"')).toBeNull();
  });

  it('returns null for text with no recognizable prefix/quote at all', () => {
    expect(extractPrefix('not a string literal')).toBeNull();
  });
});
