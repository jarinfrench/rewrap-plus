import { describe, expect, it } from 'vitest';
import { atomizeWords } from './atomize-words.js';

describe('atomizeWords', () => {
  it('splits a simple sentence into one atom per word', () => {
    expect(atomizeWords('Hello, world.')).toEqual([
      { text: 'Hello,', width: 6, breakBefore: false },
      { text: 'world.', width: 6, breakBefore: false },
    ]);
  });

  it('collapses runs of internal whitespace', () => {
    const atoms = atomizeWords('a    b\tc');
    expect(atoms.map((a) => a.text)).toEqual(['a', 'b', 'c']);
  });

  it('ignores leading and trailing whitespace', () => {
    const atoms = atomizeWords('   padded   ');
    expect(atoms).toEqual([{ text: 'padded', width: 6, breakBefore: false }]);
  });

  it('returns an empty array for a blank line', () => {
    expect(atomizeWords('   ')).toEqual([]);
    expect(atomizeWords('')).toEqual([]);
  });

  it('leaves glue undefined, meaning "join with a space"', () => {
    for (const atom of atomizeWords('one two three')) {
      expect(atom.glue).toBeUndefined();
    }
  });

  it('uses UTF-16 code-unit length as a provisional width', () => {
    // Real display width (East Asian Wide = 2 columns) lands in Phase 5;
    // this just documents today's stand-in so a future change is a
    // deliberate diff here, not a silent behavior shift.
    expect(atomizeWords('日本語')).toEqual([{ text: '日本語', width: 3, breakBefore: false }]);
  });
});
