import { describe, expect, it } from 'vitest';
import { applyLineEnding, detectLineEnding, detectLineEndingNear } from './detect-line-ending.js';

describe('detectLineEnding', () => {
  it('detects CRLF from the first line break', () => {
    expect(detectLineEnding('a\r\nb\r\nc\r\n')).toBe('\r\n');
  });

  it('detects LF from the first line break', () => {
    expect(detectLineEnding('a\nb\nc\n')).toBe('\n');
  });

  it('goes by the first line break even if later ones differ', () => {
    // Genuinely mixed line endings are out of scope for this function
    // (that's `detectLineEndingNear`'s job) — it's a per-file,
    // first-line-break detector.
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

describe('detectLineEndingNear', () => {
  // Takes the caller's own `source.split('\n')`, not the raw source
  // string — see the function's own doc comment for why (re-splitting
  // per call made wrapping every region in a large file quadratic).
  it('detects the convention of a row inside a genuinely mixed-line-ending file, independent of every other row', () => {
    // Row 0 ('a') is CRLF-terminated; row 1 ('b') is LF-terminated. Each
    // row's own detection should reflect only its own terminator, not
    // whichever convention the file happens to lead with (unlike
    // `detectLineEnding`, which is a whole-file, first-break heuristic —
    // see that function's own "goes by the first line break" test).
    const lines = 'a\r\nb\nc\r\n'.split('\n');
    expect(detectLineEndingNear(lines, 0)).toBe('\r\n');
    expect(detectLineEndingNear(lines, 1)).toBe('\n');
    expect(detectLineEndingNear(lines, 2)).toBe('\r\n');
  });

  it("falls back to the previous row's terminator for the file's last line, which has none of its own", () => {
    expect(detectLineEndingNear('a\r\nb'.split('\n'), 1)).toBe('\r\n');
    expect(detectLineEndingNear('a\nb'.split('\n'), 1)).toBe('\n');
  });

  it('falls back to whole-file detectLineEnding when the row itself has no terminator to inspect', () => {
    expect(detectLineEndingNear('a'.split('\n'), 0)).toBe('\n');
    expect(detectLineEndingNear(''.split('\n'), 0)).toBe('\n');
  });

  it('agrees with detectLineEnding for a uniformly LF or uniformly CRLF file, at any row', () => {
    const lf = 'a\nb\nc\n';
    const crlf = 'a\r\nb\r\nc\r\n';
    for (let row = 0; row < 3; row++) {
      expect(detectLineEndingNear(lf.split('\n'), row)).toBe(detectLineEnding(lf));
      expect(detectLineEndingNear(crlf.split('\n'), row)).toBe(detectLineEnding(crlf));
    }
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
