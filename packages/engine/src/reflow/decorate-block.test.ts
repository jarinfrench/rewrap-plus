import { describe, expect, it } from 'vitest';
import type { Block } from '../types/document.js';
import { decorateFirstLine, markerPrefix } from './decorate-block.js';

describe('markerPrefix', () => {
  it('places a top-level bullet flush at column 0 with one trailing space', () => {
    // '- ' -> indent(0) + marker(1) + spacing(1) = hangingIndent 2
    expect(markerPrefix('-', 2)).toBe('- ');
  });

  it('places a nested bullet at its own leading-indent column', () => {
    // '  - ' -> indent(2) + marker(1) + spacing(1) = hangingIndent 4
    expect(markerPrefix('-', 4)).toBe('  - ');
  });

  it('handles a multi-character ordered marker', () => {
    // '1. ' -> indent(0) + marker(2) + spacing(1) = hangingIndent 3
    expect(markerPrefix('1.', 3)).toBe('1. ');
  });

  it('falls back to the bare marker for pathological input with no room for a separator', () => {
    expect(markerPrefix('----', 2)).toBe('----');
  });
});

describe('decorateFirstLine', () => {
  it("prepends the marker to a listItem block's first line only", () => {
    const block: Block = { type: 'listItem', marker: '-', hangingIndent: 2, atoms: [] };
    expect(decorateFirstLine(block, ['one', 'two'])).toEqual(['- one', 'two']);
  });

  it("prepends the label to a fieldEntry block's first line only", () => {
    const block: Block = {
      type: 'fieldEntry',
      label: ':param x:',
      hangingIndent: 10, // label.length (9) + 1 separating space, no leading indent
      blocks: [],
    };
    expect(decorateFirstLine(block, ['desc', 'more'])).toEqual([':param x: desc', 'more']);
  });

  it('leaves paragraph, blank, verbatim, and sectionHeader lines untouched', () => {
    const paragraph: Block = { type: 'paragraph', atoms: [] };
    expect(decorateFirstLine(paragraph, ['hello'])).toEqual(['hello']);

    const blank: Block = { type: 'blank' };
    expect(decorateFirstLine(blank, [''])).toEqual(['']);

    const verbatim: Block = { type: 'verbatim', lines: ['x'] };
    expect(decorateFirstLine(verbatim, ['x'])).toEqual(['x']);

    const header: Block = { type: 'sectionHeader', text: 'Args:' };
    expect(decorateFirstLine(header, ['Args:'])).toEqual(['Args:']);
  });

  it('returns an empty array unchanged', () => {
    const block: Block = { type: 'listItem', marker: '-', hangingIndent: 2, atoms: [] };
    expect(decorateFirstLine(block, [])).toEqual([]);
  });

  it('trims the trailing separating space when the first line has no content to separate it from (regression)', () => {
    // `markerPrefix` always ends in exactly one separating space; gluing
    // it onto a genuinely empty first line (a `listItem`/`fieldEntry`
    // with no content at all, or a `fieldEntry` whose `blocks[0]` is
    // itself a `blank` block) used to leave that space dangling --
    // `'x: '`, not `'x:'`. Beyond the stray whitespace, this was a real
    // idempotency bug for `fieldEntry` specifically: `'x: '` (non-blank,
    // due to the label text) is indistinguishable on re-dissolve from
    // "this entry's own inline description is a single space," not "the
    // description arrives after a blank separator line" -- confirmed via
    // `test/wrap/nested-field-entry-stress.test.ts` to cost
    // `wrap(wrap(x)) === wrap(x)` a full round of drift before
    // stabilizing. Trimming instead keeps the marker's own line
    // unambiguous from the very first wrap.
    const listItem: Block = { type: 'listItem', marker: '-', hangingIndent: 2, atoms: [] };
    expect(decorateFirstLine(listItem, [''])).toEqual(['-']);

    const fieldEntry: Block = { type: 'fieldEntry', label: 'x:', hangingIndent: 3, blocks: [] };
    expect(decorateFirstLine(fieldEntry, [''])).toEqual(['x:']);

    // A later line, if any, is untouched -- only lines[0] is ever decorated.
    expect(decorateFirstLine(fieldEntry, ['', 'more'])).toEqual(['x:', 'more']);

    // An empty *label* (NumPy's own convention) degrades to a fully
    // empty line, not a dangling single space -- `markerPrefix('',
    // hangingIndent)` is pure padding to begin with, so trimming it
    // clears it entirely.
    const numpyEntry: Block = { type: 'fieldEntry', label: '', hangingIndent: 4, blocks: [] };
    expect(decorateFirstLine(numpyEntry, [''])).toEqual(['']);
  });
});
