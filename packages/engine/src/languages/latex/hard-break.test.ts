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
});
