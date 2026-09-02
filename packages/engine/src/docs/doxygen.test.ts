import { describe, expect, it } from 'vitest';
import type { Block } from '../types/document.js';
import { doxygenDialect } from './doxygen.js';

function fieldEntry(blocks: readonly Block[], index: number) {
  const block = blocks[index];
  if (block?.type !== 'fieldEntry') throw new Error(`expected fieldEntry at ${index}, got ${block?.type}`);
  return block;
}

/** A `fieldEntry`'s own nested `blocks[0]`, at step 1 always the single `paragraph` wrapping its flat atoms. */
function entryAtomTexts(entry: ReturnType<typeof fieldEntry>): string[] {
  const first = entry.blocks[0];
  if (first?.type !== 'paragraph') throw new Error('expected the entry to open with a paragraph');
  return first.atoms.map((a) => a.text);
}

describe('doxygenDialect.detect', () => {
  it('scores plain prose with no tags at 0', () => {
    expect(doxygenDialect.detect('Just a summary.\n\nMore description.')).toBe(0);
  });

  it('scores text with a recognized \\tag above 0', () => {
    expect(doxygenDialect.detect('Summary.\n\n\\param name The name.')).toBeGreaterThan(0);
  });

  it('scores text with a recognized @tag above 0, same as \\tag', () => {
    expect(doxygenDialect.detect('Summary.\n\n@param name The name.')).toBe(
      doxygenDialect.detect('Summary.\n\n\\param name The name.'),
    );
  });

  it('does not treat an indented "\\param"-like line as a tag', () => {
    expect(doxygenDialect.detect('Summary.\n\n    \\param name nested inside something else')).toBe(0);
  });
});

describe('doxygenDialect.segment', () => {
  it('segments a preamble and a flat \\tag list', () => {
    const text = ['Summary.', '', '\\param name The name.', '\\return Something.'].join('\n');
    const blocks = doxygenDialect.segment(text, {});
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'blank', 'fieldEntry', 'fieldEntry']);
    expect(fieldEntry(blocks, 2).label).toBe('\\param');
    expect(fieldEntry(blocks, 3).label).toBe('\\return');
  });

  it('preserves each tag line\'s own marker character rather than normalizing to one', () => {
    const text = ['\\param name Uses backslash.', '@return Uses at-sign.'].join('\n');
    const blocks = doxygenDialect.segment(text, {});
    expect(fieldEntry(blocks, 0).label).toBe('\\param');
    expect(fieldEntry(blocks, 1).label).toBe('@return');
  });

  it('folds a multi-line \\tag continuation into one fieldEntry', () => {
    const text = ['\\param name first part', '    continues here.'].join('\n');
    const blocks = doxygenDialect.segment(text, {});
    expect(entryAtomTexts(fieldEntry(blocks, 0))).toEqual([
      'name',
      'first',
      'part',
      'continues',
      'here.',
    ]);
  });

  it('handles \\brief/\\throws/\\note alongside \\param/\\return', () => {
    const text = [
      '\\brief Greets somebody.',
      '\\param name The name.',
      '\\return A greeting.',
      '\\throws std::invalid_argument If name is empty.',
      '\\note Not thread-safe.',
    ].join('\n');
    const blocks = doxygenDialect.segment(text, {});
    expect(blocks.map((b) => (b.type === 'fieldEntry' ? b.label : null))).toEqual([
      '\\brief',
      '\\param',
      '\\return',
      '\\throws',
      '\\note',
    ]);
  });

  it('falls back to plain prose when there is no tag at all', () => {
    const text = 'Just a summary with no tags.';
    const blocks = doxygenDialect.segment(text, {});
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe('paragraph');
  });

  it('preserves a blank line between the prose and the tag list', () => {
    const text = ['Summary.', '', '\\param name description'].join('\n');
    const blocks = doxygenDialect.segment(text, {});
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'blank', 'fieldEntry']);
  });
});
