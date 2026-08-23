import { describe, expect, it } from 'vitest';
import { visualIndentColumn } from './visual-indent-column.js';

describe('visualIndentColumn', () => {
  it('matches the raw column when there are no tabs', () => {
    expect(visualIndentColumn('    x = 1', 4, 4)).toBe(4);
  });

  it('expands a single leading tab to the tab stop', () => {
    expect(visualIndentColumn('\tx = 1', 1, 4)).toBe(4);
  });

  it('expands multiple tabs cumulatively', () => {
    expect(visualIndentColumn('\t\tx = 1', 2, 4)).toBe(8);
  });

  it('expands a tab that does not land on an even multiple of tabSize', () => {
    // One space (visual col 1), then a tab: rounds up to the next stop (4),
    // not a flat +4.
    expect(visualIndentColumn(' \tx', 2, 4)).toBe(4);
  });

  it('clamps to the line length rather than reading past it', () => {
    expect(visualIndentColumn('  ', 10, 4)).toBe(2);
  });

  it('handles a column of zero', () => {
    expect(visualIndentColumn('    x', 0, 4)).toBe(0);
  });
});
