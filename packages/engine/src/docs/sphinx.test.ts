import { describe, expect, it } from 'vitest';
import type { Block } from '../types/document.js';
import { sphinxDialect } from './sphinx.js';

function fieldEntry(blocks: readonly Block[], index: number) {
  const block = blocks[index];
  if (block?.type !== 'fieldEntry') throw new Error(`expected fieldEntry at ${index}, got ${block?.type}`);
  return block;
}

describe('sphinxDialect.detect', () => {
  it('scores plain prose with no field markers at 0', () => {
    expect(sphinxDialect.detect('Just a summary.\n\nMore description.')).toBe(0);
  });

  it('scores text with a recognized field marker above 0', () => {
    expect(sphinxDialect.detect('Summary.\n\n:param x: The x value.')).toBeGreaterThan(0);
  });

  it('does not treat an indented ":param x:"-like line as a marker', () => {
    expect(sphinxDialect.detect('Summary.\n\n    :param x: nested inside something else')).toBe(0);
  });
});

describe('sphinxDialect.segment', () => {
  it('segments a preamble and a flat field list', () => {
    const text = ['Summary.', '', ':param x: The x value.', ':returns: Something.'].join('\n');
    const blocks = sphinxDialect.segment(text, {});
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'blank', 'fieldEntry', 'fieldEntry']);
    expect(fieldEntry(blocks, 2).label).toBe(':param x:');
    expect(fieldEntry(blocks, 3).label).toBe(':returns:');
  });

  it('folds a multi-line field continuation into one fieldEntry', () => {
    const text = [':param x: first part', '    continues here.'].join('\n');
    const blocks = sphinxDialect.segment(text, {});
    expect(fieldEntry(blocks, 0).atoms.map((a) => a.text)).toEqual([
      'first',
      'part',
      'continues',
      'here.',
    ]);
  });

  it('handles :type:/:rtype:/:raises: markers alongside :param:/:returns:', () => {
    const text = [
      ':param x: The x value.',
      ':type x: int',
      ':returns: The result.',
      ':rtype: bool',
      ':raises ValueError: If x is negative.',
    ].join('\n');
    const blocks = sphinxDialect.segment(text, {});
    expect(blocks.map((b) => (b.type === 'fieldEntry' ? b.label : null))).toEqual([
      ':param x:',
      ':type x:',
      ':returns:',
      ':rtype:',
      ':raises ValueError:',
    ]);
  });

  it('falls back to plain prose when there is no field marker at all', () => {
    const text = 'Just a summary with no field list.';
    const blocks = sphinxDialect.segment(text, {});
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe('paragraph');
    const paragraph = blocks[0] as Extract<Block, { type: 'paragraph' }>;
    expect(paragraph.atoms.map((a) => a.text)).toEqual([
      'Just',
      'a',
      'summary',
      'with',
      'no',
      'field',
      'list.',
    ]);
  });

  it('preserves a blank line between the prose and the field list', () => {
    const text = ['Summary.', '', ':param x: description'].join('\n');
    const blocks = sphinxDialect.segment(text, {});
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'blank', 'fieldEntry']);
  });
});
