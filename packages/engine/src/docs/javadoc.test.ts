import { describe, expect, it } from 'vitest';
import type { Block } from '../types/document.js';
import { javadocDialect } from './javadoc.js';

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

describe('javadocDialect.detect', () => {
  it('scores plain prose with no @tags at 0', () => {
    expect(javadocDialect.detect('Just a summary.\n\nMore description.')).toBe(0);
  });

  it('scores text with a recognized @tag above 0', () => {
    expect(javadocDialect.detect('Summary.\n\n@param name The name.')).toBeGreaterThan(0);
  });

  it('does not treat an indented "@param"-like line as a tag', () => {
    expect(javadocDialect.detect('Summary.\n\n    @param name nested inside something else')).toBe(0);
  });

  it('does not treat an e-mail-shaped word as a tag marker', () => {
    // A bare '@' has to start the line — 'Contact me at foo@bar.com' never
    // matches JAVADOC_TAG at all, since the match is anchored to line
    // start — the identical anchoring `jsdocDialect`/`doxygenDialect`
    // already rely on.
    expect(javadocDialect.detect('Contact me at foo@bar.com for details.')).toBe(0);
  });
});

describe('javadocDialect.segment', () => {
  it('segments a preamble and a flat @tag list, using Javadoc\'s own "@return" (no trailing s)', () => {
    const text = ['Summary.', '', '@param name The name.', '@return Something.'].join('\n');
    const blocks = javadocDialect.segment(text, {});
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'blank', 'fieldEntry', 'fieldEntry']);
    expect(fieldEntry(blocks, 2).label).toBe('@param');
    expect(fieldEntry(blocks, 3).label).toBe('@return');
  });

  it('folds a multi-line @tag continuation into one fieldEntry', () => {
    const text = ['@param name first part', '    continues here.'].join('\n');
    const blocks = javadocDialect.segment(text, {});
    expect(entryAtomTexts(fieldEntry(blocks, 0))).toEqual([
      'name',
      'first',
      'part',
      'continues',
      'here.',
    ]);
  });

  it('handles @throws/@see/@since/@author/@deprecated alongside @param/@return', () => {
    const text = [
      '@param name The name.',
      '@return A greeting.',
      '@throws IllegalArgumentException If name is empty.',
      '@see #greetV2(String)',
      '@since 1.0',
      '@author Jarin',
      '@deprecated Use greetV2 instead.',
    ].join('\n');
    const blocks = javadocDialect.segment(text, {});
    expect(blocks.map((b) => (b.type === 'fieldEntry' ? b.label : null))).toEqual([
      '@param',
      '@return',
      '@throws',
      '@see',
      '@since',
      '@author',
      '@deprecated',
    ]);
  });

  it('falls back to plain prose when there is no @tag at all', () => {
    const text = 'Just a summary with no tags.';
    const blocks = javadocDialect.segment(text, {});
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
    const blocks = javadocDialect.segment(text, {});
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'blank', 'fieldEntry']);
  });

  it('keeps an inline {@link ...} tag intact as one atom, never split by reflow', () => {
    const text = '@param name see {@link SomeReallyLongClassName#someMethod} for details';
    const blocks = javadocDialect.segment(text, {});
    const atoms = entryAtomTexts(fieldEntry(blocks, 0));
    expect(atoms).toContain('{@link SomeReallyLongClassName#someMethod}');
  });
});
