import { describe, expect, it } from 'vitest';
import { LATEX_HARD_BREAK } from './hard-break.js';

function matches(line: string): boolean {
  return LATEX_HARD_BREAK.some((pattern) => pattern.test(line));
}

describe('LATEX_HARD_BREAK', () => {
  it('matches a trailing \\\\', () => {
    expect(matches('Some text.\\\\')).toBe(true);
  });

  it('matches a starred \\\\* with an optional vspace argument', () => {
    expect(matches('Some text.\\\\*[10pt]')).toBe(true);
  });

  it('matches \\newline, \\linebreak, \\break, and \\hline', () => {
    expect(matches('Some text.\\newline')).toBe(true);
    expect(matches('Some text.\\linebreak')).toBe(true);
    expect(matches('Some text.\\linebreak[4]')).toBe(true);
    expect(matches('Some text.\\break')).toBe(true);
    expect(matches('Some text.\\hline')).toBe(true);
  });

  it('matches with trailing whitespace after the command', () => {
    expect(matches('Some text.\\\\  ')).toBe(true);
  });

  it('does not match an ordinary line with no break command', () => {
    expect(matches('Some ordinary text with no break.')).toBe(false);
  });

  it('does not match a single backslash alone', () => {
    expect(matches('Some text.\\')).toBe(false);
  });

  it('does not match a command name that only starts with a recognized word (e.g. \\breaking)', () => {
    expect(matches('Some text.\\breaking')).toBe(false);
  });

  it('does not match a line-break command that is not at the end of the line', () => {
    expect(matches('Some text.\\\\ more text follows')).toBe(false);
  });

  it('stays fast on a long run of trailing whitespace after a real break command (no match found)', () => {
    // Regression guard for a `security/detect-unsafe-regex` false positive
    // on `LATEX_HARD_BREAK_COMMAND`: safe-regex flags the run of optional
    // groups ahead of the trailing `\s*$`, but each is gated by its own
    // distinct literal delimiter or bounded alternation, so there is no
    // shared character class for a backtracking engine to split
    // ambiguously -- confirmed here rather than just argued.
    const line = 'Some text.\\newline' + ' '.repeat(100_000) + 'x';
    const start = Date.now();
    matches(line);
    expect(Date.now() - start).toBeLessThan(1000);
  });
});
