import { describe, expect, it } from 'vitest';
import { applyLineEnding, detectLineEnding } from './detect-line-ending.js';

describe('detectLineEnding', () => {
  it('detects CRLF from the first line break', () => {
    expect(detectLineEnding('a\r\nb\r\nc\r\n')).toBe('\r\n');
  });

  it('detects LF from the first line break', () => {
    expect(detectLineEnding('a\nb\nc\n')).toBe('\n');
  });

  it('goes by the first line break even if later ones differ', () => {
    // Genuinely mixed line endings are out of scope for this function
    // (Phase 10's job) — it's a per-file, first-line-break detector.
    expect(detectLineEnding('a\r\nb\nc\n')).toBe('\r\n');
    expect(detectLineEnding('a\nb\r\nc\r\n')).toBe('\n');
  });

  it('defaults to LF when there is no line break at all', () => {
    expect(detectLineEnding('no newline here')).toBe('\n');
    expect(detectLineEnding('')).toBe('\n');
  });

  it('does not mistake a line break as the very first character for CRLF', () => {
    expect(detectLineEnding('\nfirst char is a newline')).toBe('\n');
  });
});

describe('applyLineEnding', () => {
  it('is a no-op when the target line ending is LF', () => {
    const text = 'one\ntwo\nthree';
    expect(applyLineEnding(text, '\n')).toBe(text);
  });

  it('rewrites every bare LF to CRLF', () => {
    expect(applyLineEnding('one\ntwo\nthree', '\r\n')).toBe('one\r\ntwo\r\nthree');
  });

  it('handles text with no line breaks', () => {
    expect(applyLineEnding('no breaks', '\r\n')).toBe('no breaks');
  });

  it('handles an empty string', () => {
    expect(applyLineEnding('', '\r\n')).toBe('');
  });
});
