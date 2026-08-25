import { describe, expect, it } from 'vitest';
import type { Block } from '../types/document.js';
import { googleDialect } from './google.js';

function fieldEntry(blocks: readonly Block[], index: number) {
  const block = blocks[index];
  if (block?.type !== 'fieldEntry') throw new Error(`expected fieldEntry at ${index}, got ${block?.type}`);
  return block;
}

describe('googleDialect.detect', () => {
  it('scores plain prose with no headers at 0', () => {
    expect(googleDialect.detect('Just a summary.\n\nMore description.')).toBe(0);
  });

  it('scores text with a recognized section header above 0', () => {
    expect(googleDialect.detect('Summary.\n\nArgs:\n    x: description')).toBeGreaterThan(0);
  });

  it('does not treat an unrecognized "Label:" line as a header', () => {
    expect(googleDialect.detect('Summary.\n\nCaveat: this is not a real section.')).toBe(0);
  });

  it('does not treat an indented "Args:"-like line as a header', () => {
    expect(googleDialect.detect('Summary.\n\n    Args:\n        x: y')).toBe(0);
  });
});

describe('googleDialect.segment', () => {
  it('segments a preamble and an Args section into fieldEntry blocks', () => {
    const text = ['Summary.', '', 'Args:', '    x (int): The x value.', '    y: The y value.'].join(
      '\n',
    );
    const blocks = googleDialect.segment(text, {});
    expect(blocks.map((b) => b.type)).toEqual([
      'paragraph',
      'blank',
      'sectionHeader',
      'fieldEntry',
      'fieldEntry',
    ]);
    expect(fieldEntry(blocks, 3).label).toBe('x (int):');
    expect(fieldEntry(blocks, 4).label).toBe('y:');
  });

  it('folds a multi-line entry continuation into one fieldEntry', () => {
    const text = ['Args:', '    x: first part', '        continues here.'].join('\n');
    const blocks = googleDialect.segment(text, {});
    const entry = fieldEntry(blocks, 1);
    expect(entry.atoms.map((a) => a.text)).toEqual(['first', 'part', 'continues', 'here.']);
  });

  it('falls back to plain prose for a Returns section with no recognizable entry', () => {
    const text = ['Returns:', '    A bare description with no leading type or name.'].join('\n');
    const blocks = googleDialect.segment(text, {});
    expect(blocks.map((b) => b.type)).toEqual(['sectionHeader', 'paragraph']);
  });

  it('parses a typed Returns entry as a fieldEntry', () => {
    const text = ['Returns:', '    bool: Whether it worked.'].join('\n');
    const blocks = googleDialect.segment(text, {});
    expect(fieldEntry(blocks, 1).label).toBe('bool:');
  });

  it('segments a prose-only section (Note) as ordinary paragraphs, not fieldEntry blocks', () => {
    const text = ['Note:', '    This is just prose, not a field list.'].join('\n');
    const blocks = googleDialect.segment(text, {});
    expect(blocks.map((b) => b.type)).toEqual(['sectionHeader', 'paragraph']);
  });

  it('preserves a genuine blank line inside a section body (not at the very end of the text)', () => {
    // A blank line at the *very end* of the whole `text` string is a
    // known, documented limitation (`../languages/python/dissolve-docstring.ts`'s
    // own "Known limitation" note) — `toLines` can't distinguish "ends
    // with a blank line" from "just ends here" once the line array has
    // already collapsed to a string. Mid-document blank lines, as here,
    // have no such ambiguity.
    const text = ['Args:', '    x: description', '', 'Returns:', '    bool: ok'].join('\n');
    const blocks = googleDialect.segment(text, {});
    expect(blocks.map((b) => b.type)).toEqual([
      'sectionHeader',
      'fieldEntry',
      'blank',
      'sectionHeader',
      'fieldEntry',
    ]);
  });

  it('handles multiple sections in sequence', () => {
    const text = ['Summary.', '', 'Args:', '    x: description', '', 'Returns:', '    bool: ok'].join(
      '\n',
    );
    const blocks = googleDialect.segment(text, {});
    const headers = blocks.filter((b) => b.type === 'sectionHeader').map((b) => (b as Extract<Block, { type: 'sectionHeader' }>).text);
    expect(headers).toEqual(['Args:', 'Returns:']);
  });
});
