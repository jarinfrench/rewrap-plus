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

  it('uses real display width, not character count, for CJK text', () => {
    // East Asian Wide characters count as 2 columns each (./display-width.ts)
    // — 3 characters, 6 columns, not 3.
    expect(atomizeWords('日本語')).toEqual([{ text: '日本語', width: 6, breakBefore: false }]);
  });

  it('keeps a brace placeholder whole as a single atom', () => {
    expect(atomizeWords('Total: {count} items').map((a) => a.text)).toEqual([
      'Total:',
      '{count}',
      'items',
    ]);
  });

  it('does not split an f-string interpolation at its internal whitespace', () => {
    const atoms = atomizeWords('Result: {a + b} done');
    expect(atoms.map((a) => a.text)).toEqual(['Result:', '{a + b}', 'done']);
  });

  it('does not split an inline code span at its internal whitespace', () => {
    const atoms = atomizeWords('run `git commit -m msg` first');
    expect(atoms.map((a) => a.text)).toEqual(['run', '`git commit -m msg`', 'first']);
  });

  it('does not split a reST role at its internal whitespace', () => {
    const atoms = atomizeWords('see :func:`do the thing` now');
    expect(atoms.map((a) => a.text)).toEqual(['see', ':func:`do the thing`', 'now']);
  });

  it('never splits inside an escape sequence, even mid-word', () => {
    // "a\tb" (backslash-t, not a real tab) has no internal whitespace of
    // its own to preserve, but the escape sequence still becomes its own
    // atom — glued flush to its neighbors — so later phases can reason
    // about it as a distinct unit rather than opaque substring text.
    const atoms = atomizeWords('a\\tb c');
    expect(atoms.map((a) => [a.text, a.glue])).toEqual([
      ['a', undefined],
      ['\\t', 'none'],
      ['b', 'none'],
      ['c', undefined],
    ]);
  });

  it('keeps a whole URL as one atom with no special handling needed', () => {
    expect(atomizeWords('see https://example.com/a/b now').map((a) => a.text)).toEqual([
      'see',
      'https://example.com/a/b',
      'now',
    ]);
  });

  it('tags an atom glued flush to its predecessor with glue: none', () => {
    const atoms = atomizeWords('{name}, welcome!');
    expect(atoms).toEqual([
      { text: '{name}', width: 6, breakBefore: false },
      { text: ',', width: 1, breakBefore: false, glue: 'none' },
      { text: 'welcome!', width: 8, breakBefore: false },
    ]);
  });

  it('does not tag glue: none when a space separates atoms', () => {
    const atoms = atomizeWords('{name} , welcome');
    for (const atom of atoms) {
      expect(atom.glue).toBeUndefined();
    }
  });

  it('handles a run made of several adjacent unbreakable spans', () => {
    // "Value:" + "{x}" glued, with no space anywhere in the run.
    const atoms = atomizeWords('Value:{x}.');
    expect(atoms.map((a) => [a.text, a.glue])).toEqual([
      ['Value:', undefined],
      ['{x}', 'none'],
      ['.', 'none'],
    ]);
  });
});
