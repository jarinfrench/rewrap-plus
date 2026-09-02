import { describe, expect, it } from 'vitest';
import type { Block } from '../types/document.js';
import { numpyDialect } from './numpy.js';

function headerText(block: Block | undefined): string {
  if (block?.type !== 'sectionHeader') throw new Error(`expected sectionHeader, got ${block?.type}`);
  return block.text;
}

describe('numpyDialect.detect', () => {
  it('scores plain prose with no header/underline pairing at 0', () => {
    expect(numpyDialect.detect('Just a summary.\n\nMore description.')).toBe(0);
  });

  it('scores text with a recognized header+underline pairing above 0', () => {
    expect(numpyDialect.detect('Summary.\n\nParameters\n----------\nx : int\n    The x value.')).toBeGreaterThan(0);
  });

  it('does not treat a header without a following dash-underline as a match', () => {
    expect(numpyDialect.detect('Parameters\nx : int')).toBe(0);
  });

  it('does not treat an unrecognized name with a dash-underline as a match', () => {
    expect(numpyDialect.detect('Not A Real Section\n-------------------')).toBe(0);
  });
});

describe('numpyDialect.segment', () => {
  it('segments a header, regenerated underline, and entries', () => {
    const text = ['Parameters', '----------', 'x : int', '    The x value.'].join('\n');
    const blocks = numpyDialect.segment(text, {});
    expect(blocks.map((b) => b.type)).toEqual(['sectionHeader', 'sectionHeader', 'sectionHeader', 'fieldEntry']);
    expect(headerText(blocks[0])).toBe('Parameters');
    expect(headerText(blocks[1])).toBe('----------');
    expect(headerText(blocks[2])).toBe('x : int');
  });

  it('regenerates the underline to match the header length regardless of the original', () => {
    const text = ['Parameters', '---', 'x : int', '    desc'].join('\n');
    const blocks = numpyDialect.segment(text, {});
    expect(headerText(blocks[1])).toBe('-'.repeat('Parameters'.length));
  });

  it('handles an entry with no type, only a name', () => {
    const text = ['Returns', '-------', 'bool', '    Whether it worked.'].join('\n');
    const blocks = numpyDialect.segment(text, {});
    expect(headerText(blocks[2])).toBe('bool');
    const description = blocks[3];
    if (description?.type !== 'fieldEntry') throw new Error('expected fieldEntry');
    expect(description.label).toBe('');
    const first = description.blocks[0];
    if (first?.type !== 'paragraph') throw new Error('expected the entry to open with a paragraph');
    expect(first.atoms.map((a) => a.text)).toEqual(['Whether', 'it', 'worked.']);
  });

  it('handles multiple entries in one section', () => {
    const text = ['Parameters', '----------', 'x : int', '    First.', 'y : str', '    Second.'].join(
      '\n',
    );
    const blocks = numpyDialect.segment(text, {});
    const labelLines = blocks
      .filter((b) => b.type === 'sectionHeader')
      .map((b) => (b as Extract<Block, { type: 'sectionHeader' }>).text);
    expect(labelLines).toEqual(['Parameters', '----------', 'x : int', 'y : str']);
  });

  it('segments a prose-only section (Notes) as ordinary paragraphs', () => {
    const text = ['Notes', '-----', 'Just some prose here.'].join('\n');
    const blocks = numpyDialect.segment(text, {});
    expect(blocks.map((b) => b.type)).toEqual(['sectionHeader', 'sectionHeader', 'paragraph']);
  });

  it('includes a preamble before the first section as ordinary blocks', () => {
    const text = ['Summary.', '', 'Parameters', '----------', 'x : int', '    desc'].join('\n');
    const blocks = numpyDialect.segment(text, {});
    expect(blocks[0]?.type).toBe('paragraph');
    expect(blocks[1]?.type).toBe('blank');
  });
});
