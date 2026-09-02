import { describe, expect, it } from 'vitest';
import type { Block } from '../types/document.js';
import { groupFieldEntries, type EntryStartMatch } from './field-entries.js';

function matchSimple(line: string): EntryStartMatch | null {
  const m = /^[ \t]*([a-z]+):\s?(.*)$/.exec(line);
  if (!m) return null;
  const [, name = '', rest = ''] = m;
  return { label: `${name}:`, rest };
}

/** A `fieldEntry`'s own nested `blocks[0]`, at step 1 always the single `paragraph` wrapping its flat atoms. */
function entryAtomTexts(entry: Extract<Block, { type: 'fieldEntry' }>): string[] {
  const first = entry.blocks[0];
  if (first?.type !== 'paragraph') throw new Error('expected the entry to open with a paragraph');
  return first.atoms.map((a) => a.text);
}

describe('groupFieldEntries', () => {
  it('groups a single entry with no continuation', () => {
    const blocks = groupFieldEntries(['x: description'], matchSimple);
    expect(blocks).toEqual([
      {
        type: 'fieldEntry',
        label: 'x:',
        hangingIndent: 4, // entry's own indent (0) + the default continuation width (4)
        blocks: [
          { type: 'paragraph', atoms: [{ text: 'description', width: 11, breakBefore: false }] },
        ],
      },
    ]);
  });

  it('folds indented continuation lines into the entry’s atoms', () => {
    const blocks = groupFieldEntries(['x: first line', '    continues here'], matchSimple);
    expect(blocks).toHaveLength(1);
    const entry = blocks[0];
    if (entry?.type !== 'fieldEntry') throw new Error('expected a fieldEntry');
    expect(entryAtomTexts(entry)).toEqual(['first', 'line', 'continues', 'here']);
  });

  it('starts a new entry when a new label line appears, even if indented no further', () => {
    const blocks = groupFieldEntries(['x: one', 'y: two'], matchSimple);
    expect(blocks).toHaveLength(2);
    expect(blocks.map((b) => (b.type === 'fieldEntry' ? b.label : null))).toEqual(['x:', 'y:']);
  });

  it('starts a new entry when a matching line sits at a shallower indent than the current entry', () => {
    const blocks = groupFieldEntries(['    x: one', '    y: two'], matchSimple);
    expect(blocks).toHaveLength(2);
    expect(blocks.map((b) => (b.type === 'fieldEntry' ? b.label : null))).toEqual(['x:', 'y:']);
  });

  it('does not start a new entry when a matching line is indented deeper than the current entry (regression)', () => {
    // A real fix, not just a workaround for one fixture: `groupFieldEntries`
    // used to end continuation on *any* line matching `matchEntryStart`,
    // regardless of its indent. A field entry's flattened description can
    // legitimately contain a `word:` substring (a nested bullet's own
    // "label: description" shape, plain prose with a colon in it), and
    // reflow is free to break a line right before that word on any given
    // wrap — when it did, the deeper-indented match was misread as a new
    // sibling entry despite sitting at the *continuation* indent, not the
    // entries' own shared indent, breaking `wrap(wrap(x)) === wrap(x)` for
    // `test/fixtures/python/docstrings/012-pathological-google.*` under
    // `test/wrap/idempotency-all-fixtures.test.ts`. A deeper match must
    // stay folded into the entry that's still open.
    const blocks = groupFieldEntries(['x: one', '   y: two'], matchSimple);
    expect(blocks).toHaveLength(1);
    const entry = blocks[0];
    if (entry?.type !== 'fieldEntry') throw new Error('expected a fieldEntry');
    expect(entry.label).toBe('x:');
    expect(entryAtomTexts(entry)).toEqual(['one', 'y:', 'two']);
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

  describe('look-ahead body collection (blank lines inside continuation)', () => {
    it('does not end the entry at a blank line followed by more continuation', () => {
      const blocks = groupFieldEntries(
        ['x: first', '    continues', '', '    more after blank'],
        matchSimple,
      );
      // A strict per-line "blank always ends continuation" loop would have
      // produced 3 blocks here (fieldEntry, blank, a paragraph for the
      // trailing line) — see this file's own "Known limitation" doc
      // comment. One fieldEntry, with the blank line contributing zero
      // atoms, confirms the look-ahead collection kept it all together.
      expect(blocks).toHaveLength(1);
      const entry = blocks[0];
      if (entry?.type !== 'fieldEntry') throw new Error('expected a fieldEntry');
      expect(entryAtomTexts(entry)).toEqual(['first', 'continues', 'more', 'after', 'blank']);
    });

    it('tolerates more than one consecutive blank line inside continuation', () => {
      const blocks = groupFieldEntries(
        ['x: first', '    continues', '', '', '    more'],
        matchSimple,
      );
      expect(blocks).toHaveLength(1);
      const entry = blocks[0];
      if (entry?.type !== 'fieldEntry') throw new Error('expected a fieldEntry');
      expect(entryAtomTexts(entry)).toEqual(['first', 'continues', 'more']);
    });

    it('still ends the entry at a genuinely trailing blank line (no further continuation)', () => {
      const blocks = groupFieldEntries(['x: first', '    continues', ''], matchSimple);
      expect(blocks.map((b) => b.type)).toEqual(['fieldEntry', 'blank']);
      const entry = blocks[0];
      if (entry?.type !== 'fieldEntry') throw new Error('expected a fieldEntry');
      expect(entryAtomTexts(entry)).toEqual(['first', 'continues']);
    });

    it('still ends the entry at a blank line followed by a new sibling entry, unchanged from before', () => {
      const blocks = groupFieldEntries(
        ['x: first', '    continues', '', 'y: two'],
        matchSimple,
      );
      expect(blocks.map((b) => b.type)).toEqual(['fieldEntry', 'blank', 'fieldEntry']);
      const first = blocks[0];
      if (first?.type !== 'fieldEntry') throw new Error('expected a fieldEntry');
      expect(entryAtomTexts(first)).toEqual(['first', 'continues']);
    });
  });
});
