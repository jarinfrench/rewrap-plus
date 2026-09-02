import { describe, expect, it } from 'vitest';
import type { Block } from '../types/document.js';
import { jsdocDialect } from './jsdoc.js';

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

describe('jsdocDialect.detect', () => {
  it('scores plain prose with no @tags at 0', () => {
    expect(jsdocDialect.detect('Just a summary.\n\nMore description.')).toBe(0);
  });

  it('scores text with a recognized @tag above 0', () => {
    expect(jsdocDialect.detect('Summary.\n\n@param name The name.')).toBeGreaterThan(0);
  });

  it('does not treat an indented "@param"-like line as a tag', () => {
    expect(jsdocDialect.detect('Summary.\n\n    @param name nested inside something else')).toBe(0);
  });

  it('does not treat an e-mail-shaped word as a tag marker', () => {
    // A bare '@' has to start the line — 'Contact me at foo@bar.com' never
    // matches JSDOC_TAG at all, since the match is anchored to line start.
    expect(jsdocDialect.detect('Contact me at foo@bar.com for details.')).toBe(0);
  });
});

describe('jsdocDialect.segment', () => {
  it('segments a preamble and a flat @tag list', () => {
    const text = ['Summary.', '', '@param name The name.', '@returns Something.'].join('\n');
    const blocks = jsdocDialect.segment(text, {});
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'blank', 'fieldEntry', 'fieldEntry']);
    expect(fieldEntry(blocks, 2).label).toBe('@param');
    expect(fieldEntry(blocks, 3).label).toBe('@returns');
  });

  it('folds a multi-line @tag continuation into one fieldEntry', () => {
    const text = ['@param name first part', '    continues here.'].join('\n');
    const blocks = jsdocDialect.segment(text, {});
    expect(entryAtomTexts(fieldEntry(blocks, 0))).toEqual([
      'name',
      'first',
      'part',
      'continues',
      'here.',
    ]);
  });

  it('handles @throws/@example/@deprecated alongside @param/@returns', () => {
    const text = [
      '@param name The name.',
      '@returns A greeting.',
      '@throws {Error} If name is empty.',
      '@example greet("world")',
      '@deprecated Use greetV2 instead.',
    ].join('\n');
    const blocks = jsdocDialect.segment(text, {});
    expect(blocks.map((b) => (b.type === 'fieldEntry' ? b.label : null))).toEqual([
      '@param',
      '@returns',
      '@throws',
      '@example',
      '@deprecated',
    ]);
  });

  it('falls back to plain prose when there is no @tag at all', () => {
    const text = 'Just a summary with no tags.';
    const blocks = jsdocDialect.segment(text, {});
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe('paragraph');
    const paragraph = blocks[0] as Extract<Block, { type: 'paragraph' }>;
    expect(paragraph.atoms.map((a) => a.text)).toEqual([
      'Just',
      'a',
      'summary',
      'with',
      'no',
      'tags.',
    ]);
  });

  it('preserves a blank line between the prose and the @tag list', () => {
    const text = ['Summary.', '', '@param name description'].join('\n');
    const blocks = jsdocDialect.segment(text, {});
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'blank', 'fieldEntry']);
  });

  it('recognizes a nested list inside a @tag description, end to end through segment()', () => {
    // Mechanical once Google worked (both share `groupFieldEntries`),
    // per the plan's own framing — confirmed directly rather than
    // assumed.
    const text = ['@param opts Options include:', '    - verbose mode', '    - strict mode'].join(
      '\n',
    );
    const blocks = jsdocDialect.segment(text, {});
    const entry = fieldEntry(blocks, 0);
    expect(entry.blocks.map((b) => b.type)).toEqual(['paragraph', 'listItem', 'listItem']);
    const item0 = entry.blocks[1];
    if (item0?.type !== 'listItem') throw new Error('expected a listItem');
    expect(item0.marker).toBe('-');
    expect(item0.atoms.map((a) => a.text)).toEqual(['verbose', 'mode']);
  });

  it('keeps a {Type} annotation intact as one atom, never split by reflow', () => {
    const text = '@param {SomeReallyLongTypeAnnotationName} name description';
    const blocks = jsdocDialect.segment(text, {});
    const atoms = entryAtomTexts(fieldEntry(blocks, 0));
    expect(atoms[0]).toBe('{SomeReallyLongTypeAnnotationName}');
  });
});
