import { describe, expect, it } from 'vitest';
import { classifyPrefix, extractPrefix } from './prefix.js';

describe('extractPrefix', () => {
  it('extracts an empty prefix for a plain double-quoted string', () => {
    expect(extractPrefix('"hello"')).toBe('');
  });

  it('extracts an empty prefix for a plain single-quoted string', () => {
    expect(extractPrefix("'hello'")).toBe('');
  });

  it('extracts an empty prefix for a triple-quoted string without matching the single quote first', () => {
    expect(extractPrefix('"""hello"""')).toBe('');
    expect(extractPrefix("'''hello'''")).toBe('');
  });

  it('extracts a single-letter prefix, lowercased', () => {
    expect(extractPrefix('r"raw"')).toBe('r');
    expect(extractPrefix('R"raw"')).toBe('r');
    expect(extractPrefix('B"bytes"')).toBe('b');
    expect(extractPrefix('F"fstring"')).toBe('f');
  });

  it('extracts a two-letter prefix in either order, lowercased', () => {
    expect(extractPrefix('rb"x"')).toBe('rb');
    expect(extractPrefix('br"x"')).toBe('br');
    expect(extractPrefix('Rb"x"')).toBe('rb');
    expect(extractPrefix('bR"x"')).toBe('br');
    expect(extractPrefix('rf"x"')).toBe('rf');
    expect(extractPrefix('FR"x"')).toBe('fr');
  });

  it('extracts a prefix ahead of a triple-quoted opening delimiter', () => {
    expect(extractPrefix('rb"""x"""')).toBe('rb');
  });

  it('returns an empty string, not null, when there genuinely is no prefix', () => {
    expect(extractPrefix('"x"')).not.toBeNull();
    expect(extractPrefix('"x"')).toBe('');
  });

  it('returns null when the text has no recognizable quote at all', () => {
    expect(extractPrefix('not a string literal')).toBeNull();
    expect(extractPrefix('')).toBeNull();
  });
});

describe('classifyPrefix', () => {
  it('flags no attributes for an empty prefix', () => {
    const parsed = classifyPrefix('');
    expect(parsed).toEqual({ raw: false, bytes: false, formatted: false, normalized: '' });
  });

  it('flags a u prefix as none of raw/bytes/formatted', () => {
    const parsed = classifyPrefix('u');
    expect(parsed.raw).toBe(false);
    expect(parsed.bytes).toBe(false);
    expect(parsed.formatted).toBe(false);
  });

  it('flags raw for r', () => {
    expect(classifyPrefix('r').raw).toBe(true);
  });

  it('flags bytes for b', () => {
    expect(classifyPrefix('b').bytes).toBe(true);
  });

  it('flags formatted for f', () => {
    expect(classifyPrefix('f').formatted).toBe(true);
  });

  it('flags both raw and bytes for rb', () => {
    const parsed = classifyPrefix('rb');
    expect(parsed.raw).toBe(true);
    expect(parsed.bytes).toBe(true);
    expect(parsed.formatted).toBe(false);
  });

  it('flags both raw and formatted for rf', () => {
    const parsed = classifyPrefix('rf');
    expect(parsed.raw).toBe(true);
    expect(parsed.formatted).toBe(true);
    expect(parsed.bytes).toBe(false);
  });

  it('normalizes rb and br to the same canonical form', () => {
    expect(classifyPrefix('rb').normalized).toBe(classifyPrefix('br').normalized);
  });

  it('normalizes rf and fr to the same canonical form', () => {
    expect(classifyPrefix('rf').normalized).toBe(classifyPrefix('fr').normalized);
  });

  it('gives distinct prefixes distinct normalized forms', () => {
    const forms = ['', 'u', 'r', 'f', 'b', 'rb', 'rf'].map((p) => classifyPrefix(p).normalized);
    expect(new Set(forms).size).toBe(forms.length);
  });
});
