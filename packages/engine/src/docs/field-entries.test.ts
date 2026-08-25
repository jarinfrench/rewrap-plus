import { describe, expect, it } from 'vitest';
import { groupFieldEntries, type EntryStartMatch } from './field-entries.js';

function matchSimple(line: string): EntryStartMatch | null {
  const m = /^[ \t]*([a-z]+):\s?(.*)$/.exec(line);
  if (!m) return null;
  const [, name = '', rest = ''] = m;
  return { label: `${name}:`, rest };
}

describe('groupFieldEntries', () => {
  it('groups a single entry with no continuation', () => {
    const blocks = groupFieldEntries(['x: description'], matchSimple);
    expect(blocks).toEqual([
      {
        type: 'fieldEntry',
        label: 'x:',
        hangingIndent: 4, // entry's own indent (0) + the default continuation width (4)
        atoms: [{ text: 'description', width: 11, breakBefore: false }],
      },
    ]);
  });

  it('folds indented continuation lines into the entry’s atoms', () => {
    const blocks = groupFieldEntries(['x: first line', '    continues here'], matchSimple);
    expect(blocks).toHaveLength(1);
    const entry = blocks[0];
    if (entry?.type !== 'fieldEntry') throw new Error('expected a fieldEntry');
    expect(entry.atoms.map((a) => a.text)).toEqual(['first', 'line', 'continues', 'here']);
  });

  it('starts a new entry when a new label line appears, even if indented no further', () => {
    const blocks = groupFieldEntries(['x: one', 'y: two'], matchSimple);
    expect(blocks).toHaveLength(2);
    expect(blocks.map((b) => (b.type === 'fieldEntry' ? b.label : null))).toEqual(['x:', 'y:']);
  });

  it('emits a blank block for a blank line', () => {
    const blocks = groupFieldEntries(['x: one', '', 'y: two'], matchSimple);
    expect(blocks.map((b) => b.type)).toEqual(['fieldEntry', 'blank', 'fieldEntry']);
  });

  it('folds an unmatched, non-continuation line in as a plain paragraph', () => {
    const blocks = groupFieldEntries(['not an entry at all'], matchSimple);
    expect(blocks).toEqual([
      { type: 'paragraph', atoms: [{ text: 'not', width: 3, breakBefore: false }, { text: 'an', width: 2, breakBefore: false }, { text: 'entry', width: 5, breakBefore: false }, { text: 'at', width: 2, breakBefore: false }, { text: 'all', width: 3, breakBefore: false }] },
    ]);
  });

  it('reflects the entry’s own leading indent in hangingIndent', () => {
    const blocks = groupFieldEntries(['    x: description'], matchSimple);
    const entry = blocks[0];
    if (entry?.type !== 'fieldEntry') throw new Error('expected a fieldEntry');
    // entry's own indent (4) + the default continuation width (4)
    expect(entry.hangingIndent).toBe(8);
  });
});
