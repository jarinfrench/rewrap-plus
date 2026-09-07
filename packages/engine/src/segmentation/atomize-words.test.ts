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
    // -- 3 characters, 6 columns, not 3.
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
    // atom -- glued flush to its neighbors -- so later phases can reason
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

  it('tags an atom glue: double when it follows two spaces after a sentence-ending period', () => {
    const atoms = atomizeWords('End of one.  Start of next.');
    expect(atoms.map((a) => [a.text, a.glue])).toEqual([
      ['End', undefined],
      ['of', undefined],
      ['one.', undefined],
      ['Start', 'double'],
      ['of', undefined],
      ['next.', undefined],
    ]);
  });

  it('also preserves double spacing after ! and ?', () => {
    expect(atomizeWords('Really!  Yes.').map((a) => a.glue)).toEqual([undefined, 'double']);
    expect(atomizeWords('Sure?  Okay.').map((a) => a.glue)).toEqual([undefined, 'double']);
  });

  it('does not tag glue: double after a single space, even following sentence-ending punctuation', () => {
    const atoms = atomizeWords('End of one. Start of next.');
    for (const atom of atoms) {
      expect(atom.glue).toBeUndefined();
    }
  });

  it('does not tag glue: double for a double space that does not follow sentence-ending punctuation', () => {
    // Two spaces after "one" (no trailing punctuation) is exactly the
    // kind of incidental whitespace prose reflow is meant to normalize
    // away, not a sentence boundary to preserve.
    const atoms = atomizeWords('End of one  and then more');
    for (const atom of atoms) {
      expect(atom.glue).toBeUndefined();
    }
  });

  it('does not tag glue: double for three-or-more spaces after sentence-ending punctuation', () => {
    // Still collapses to the ordinary single join, same as any other
    // over-two-space run elsewhere in a line -- "double" means exactly
    // "the source had a deliberate two-space sentence gap here", not
    // "the source had extra whitespace here".
    const atoms = atomizeWords('End of one.    Start of next.');
    for (const atom of atoms) {
      expect(atom.glue).toBeUndefined();
    }
  });

  it('does not split an extra caller-supplied unbreakable pattern at its internal whitespace', () => {
    // The `\verb`/`\lstinline` shape -- real content the built-in
    // pattern set knows nothing about.
    const verb = /\\verb\*?(.)[^\n]*?\1/;
    const atoms = atomizeWords('see \\verb|a b c| now', { extraUnbreakable: [verb] });
    expect(atoms.map((a) => a.text)).toEqual(['see', '\\verb|a b c|', 'now']);
  });

  it('splits normally, ignoring extraUnbreakable, when the text does not match any extra pattern', () => {
    const neverMatches = /NEVER_MATCHES_ANYTHING_XYZ/;
    const atoms = atomizeWords('plain text here', { extraUnbreakable: [neverMatches] });
    expect(atoms.map((a) => a.text)).toEqual(['plain', 'text', 'here']);
  });

  it('behaves identically to omitting options when extraUnbreakable is not given', () => {
    expect(atomizeWords('Hello, world.', {})).toEqual(atomizeWords('Hello, world.'));
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
