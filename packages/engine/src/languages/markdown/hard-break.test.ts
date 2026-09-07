import { describe, expect, it } from 'vitest';
import { MARKDOWN_HARD_BREAK } from './hard-break.js';

const [hardBreak] = MARKDOWN_HARD_BREAK;

function exec(line: string): { index: number; text: string } | null {
  const match = hardBreak!.exec(line);
  return match ? { index: match.index, text: match[0] } : null;
}

describe('MARKDOWN_HARD_BREAK -- two-space and <br> forms', () => {
  it('matches exactly two trailing spaces', () => {
    expect(exec('some text  ')).toEqual({ index: 9, text: '  ' });
  });

  it('matches three or more trailing spaces, the whole run', () => {
    expect(exec('some text    ')).toEqual({ index: 9, text: '    ' });
  });

  it('does not match a single trailing space', () => {
    expect(exec('some text ')).toBeNull();
  });

  it('matches <br>', () => {
    expect(exec('some text<br>')).toEqual({ index: 9, text: '<br>' });
  });

  it('matches <br/> and <br />', () => {
    expect(exec('some text<br/>')).toEqual({ index: 9, text: '<br/>' });
    expect(exec('some text<br />')).toEqual({ index: 9, text: '<br />' });
  });

  it('matches <BR> case-insensitively', () => {
    expect(exec('some text<BR>')).toEqual({ index: 9, text: '<BR>' });
  });

  it('does not match <br> in the middle of a line', () => {
    expect(exec('some<br>text')).toBeNull();
  });
});

describe('MARKDOWN_HARD_BREAK -- trailing backslash parity', () => {
  it('matches a single trailing backslash', () => {
    expect(exec('some text\\')).toEqual({ index: 9, text: '\\' });
  });

  it('does not match two trailing backslashes (one escaped, literal backslash)', () => {
    expect(exec('some text\\\\')).toBeNull();
  });

  it('matches three trailing backslashes -- one escaped pair plus one real trailing backslash', () => {
    // "some text" + 3 backslash characters.
    const line = 'some text' + '\\'.repeat(3);
    const result = exec(line);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('\\');
    // The marker is only the *last* backslash character -- index 11, not 9.
    expect(result!.index).toBe(line.length - 1);
  });

  it('does not match four trailing backslashes (two escaped pairs)', () => {
    expect(exec('some text' + '\\'.repeat(4))).toBeNull();
  });

  it('matches five trailing backslashes -- two escaped pairs plus one real trailing backslash', () => {
    const line = 'some text' + '\\'.repeat(5);
    const result = exec(line);
    expect(result).not.toBeNull();
    expect(result!.index).toBe(line.length - 1);
  });

  it('does not match a backslash that is not at the very end of the line', () => {
    expect(exec('some\\text here')).toBeNull();
  });
});

describe('MARKDOWN_HARD_BREAK -- ordinary lines', () => {
  it('does not match an ordinary line with no trailing marker', () => {
    expect(exec('just an ordinary line')).toBeNull();
  });

  it('does not match an empty line', () => {
    expect(exec('')).toBeNull();
  });
});
