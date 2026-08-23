import { describe, expect, it } from 'vitest';
import { toLines } from './to-lines.js';

describe('toLines', () => {
  it('splits on LF', () => {
    expect(toLines('a\nb\nc')).toEqual(['a', 'b', 'c']);
  });

  it('splits on CRLF', () => {
    expect(toLines('a\r\nb\r\nc')).toEqual(['a', 'b', 'c']);
  });

  it('splits on bare CR', () => {
    expect(toLines('a\rb\rc')).toEqual(['a', 'b', 'c']);
  });

  it('drops the single trailing empty element from a final newline', () => {
    expect(toLines('a\nb\n')).toEqual(['a', 'b']);
  });

  it('preserves a genuine trailing blank line (two trailing newlines)', () => {
    expect(toLines('a\nb\n\n')).toEqual(['a', 'b', '']);
  });

  it('handles text with no trailing newline', () => {
    expect(toLines('a\nb')).toEqual(['a', 'b']);
  });

  it('handles empty input as a single empty line', () => {
    expect(toLines('')).toEqual([]);
  });

  it('treats a lone newline as one blank line, not zero', () => {
    expect(toLines('\n')).toEqual(['']);
  });
});
