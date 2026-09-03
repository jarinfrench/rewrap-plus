import { describe, expect, it } from 'vitest';
import { LATEX_TRAILING_COMMENT_HARD_BREAK } from './trailing-comment.js';

function match(line: string): RegExpExecArray | null {
  return LATEX_TRAILING_COMMENT_HARD_BREAK[0]!.exec(line);
}

describe('LATEX_TRAILING_COMMENT_HARD_BREAK', () => {
  it('matches a bare trailing % comment', () => {
    const result = match('aaa bbb % note');
    expect(result).not.toBeNull();
    expect(result![0]).toBe(' % note');
    expect(result!.index).toBe(7); // right after "bbb", before the space
  });

  it('normalizes to exactly one space regardless of source spacing', () => {
    expect(match('aaa   % note')![0]).toBe(' % note');
    expect(match('aaa% note')![0]).toBe(' % note'); // no space at all in source
  });

  it('returns null for a line with no comment at all', () => {
    expect(match('aaa bbb ccc')).toBeNull();
  });

  it('does not match an escaped \\% (1 backslash — odd, escaped)', () => {
    expect(match('100\\% of the time')).toBeNull();
  });

  it('matches after \\\\ (2 backslashes — even, real comment)', () => {
    // \\ is LaTeX's own line-break command, a complete two-character
    // token; the % right after it is genuinely unescaped. Confirmed
    // directly against the grammar, not assumed — docs/spikes/tree-sitter-latex-probe6.mjs.
    const result = match('text \\\\ % real comment');
    expect(result).not.toBeNull();
    expect(result![0]).toBe(' % real comment');
  });

  it('does not match after 3 backslashes (odd — \\\\ plus escaped \\%)', () => {
    expect(match('text \\\\\\% not a comment')).toBeNull();
  });

  it('matches after 4 backslashes (even — two complete \\\\ tokens)', () => {
    const result = match('text \\\\\\\\% real comment');
    expect(result).not.toBeNull();
    expect(result![0]).toBe(' % real comment');
  });

  it('skips an earlier escaped \\% and finds a later real comment on the same line', () => {
    const result = match('100\\% done % real note');
    expect(result).not.toBeNull();
    expect(result![0]).toBe(' % real note');
    expect(result!.index).toBe(10); // right after "done", before its own leading space
  });

  it('content before the match excludes trailing whitespace, matching what atomizeWords would drop anyway', () => {
    const result = match('aaa bbb   % note');
    expect(result!.index).toBe(7); // right after "bbb", not after the 3 spaces
  });
});
