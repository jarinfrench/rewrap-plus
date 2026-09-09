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

  it('reflows an indented prose section (Notes) body as a paragraph, not a verbatim block, under preserveIndentedBlocks (regression)', () => {
    // Same underlying bug as `./google.test.ts`'s parallel regression
    // case, though narrower in practice: canonical numpydoc prose-section
    // bodies are flush left, not hanging-indented under their
    // header+underline the way Google's are (see the numpydoc format
    // guide's own `Notes`/`Examples` examples), so most real-world NumPy
    // docstrings never reach this code path with a nonzero first-line
    // indent at all. A hand-indented (still entirely plausible, just
    // non-canonical) body does reach it, and before `dedentBody` was
    // applied ahead of `segmentLines` here (see `./numpy.ts`'s `segment`,
    // `PROSE_SECTIONS` branch), `preserveIndentedBlocks`'s "any indented
    // line becomes verbatim" rule (`../segmentation/split-blocks.ts`)
    // misread that indent as a nested indented block and never reflowed
    // it. NumPy's own `FIELD_SECTIONS` branch (`segmentFieldSection`) was
    // never affected -- it establishes `baseIndent` positionally from the
    // body's own first line rather than assuming column 0.
    const text = ['Notes', '-----', '    Just some prose here, hand-indented under its header.'].join(
      '\n',
    );
    const blocks = numpyDialect.segment(text, { preserveIndentedBlocks: true });
    expect(blocks.map((b) => b.type)).toEqual(['sectionHeader', 'sectionHeader', 'paragraph']);
  });

  it('includes a preamble before the first section as ordinary blocks', () => {
    const text = ['Summary.', '', 'Parameters', '----------', 'x : int', '    desc'].join('\n');
    const blocks = numpyDialect.segment(text, {});
    expect(blocks[0]?.type).toBe('paragraph');
    expect(blocks[1]?.type).toBe('blank');
  });

  it('recognizes a nested list and a fenced sample inside a description, end to end through segment()', () => {
    // `segmentFieldSection`'s own parallel fix to `groupFieldEntries`'s
    // (`../field-entries.ts`) -- a separate implementation (NumPy
    // recognizes entries by indent position, not a `matchEntryStart`
    // regex), confirmed here through the real dialect entry point.
    const text = [
      'Parameters',
      '----------',
      'dry_run : bool',
      '    Options include:',
      '    - verbose mode',
      '    - strict mode',
      '    Example:',
      '    ```',
      '    deploy(dry_run=True)',
      '    ```',
    ].join('\n');
    const blocks = numpyDialect.segment(text, {});
    expect(blocks.map((b) => b.type)).toEqual(['sectionHeader', 'sectionHeader', 'sectionHeader', 'fieldEntry']);
    const entry = blocks[3];
    if (entry?.type !== 'fieldEntry') throw new Error('expected fieldEntry');
    expect(entry.blocks.map((b) => b.type)).toEqual([
      'paragraph',
      'listItem',
      'listItem',
      'paragraph',
      'verbatim',
    ]);
    const item0 = entry.blocks[1];
    if (item0?.type !== 'listItem') throw new Error('expected a listItem');
    expect(item0.marker).toBe('-');
    expect(item0.atoms.map((a) => a.text)).toEqual(['verbose', 'mode']);
    const verbatim = entry.blocks[4];
    if (verbatim?.type !== 'verbatim') throw new Error('expected a verbatim block');
    expect(verbatim.lines).toEqual(['```', 'deploy(dry_run=True)', '```']);
  });

  it('recognizes a nested list when the description opens directly with a bullet (no leading prose)', () => {
    // NumPy's entries never have an inline "rest" the way Google/Sphinx
    // do (the header and description are never on the same physical
    // line) -- `blocks[0]` being a `listItem` here isn't gated on an
    // empty-`entry.rest` special case the way `../field-entries.ts`'s
    // is, it's simply what the description's first collected line was.
    const text = ['Parameters', '----------', 'x : int', '    - first', '    - second'].join('\n');
    const blocks = numpyDialect.segment(text, {});
    const entry = blocks[3];
    if (entry?.type !== 'fieldEntry') throw new Error('expected fieldEntry');
    expect(entry.blocks.map((b) => b.type)).toEqual(['listItem', 'listItem']);
  });

  it('does not end a description at a blank line followed by more description (look-ahead collection)', () => {
    const text = [
      'Parameters',
      '----------',
      'x : int',
      '    First part.',
      '',
      '    More after blank.',
    ].join('\n');
    const blocks = numpyDialect.segment(text, {});
    const entry = blocks[3];
    if (entry?.type !== 'fieldEntry') throw new Error('expected fieldEntry');
    expect(entry.blocks.map((b) => b.type)).toEqual(['paragraph', 'blank', 'paragraph']);
  });

  it('strips a blank line right after the header, before any real description content (regression)', () => {
    // NumPy's label is always empty, so a leading blank block here is
    // *always* in scope for `stripLeadingBlanks` -- unlike Google/Sphinx,
    // there's no `entry.rest` gate to check first. Confirmed via
    // `test/wrap/nested-field-entry-stress.test.ts`: left in, this was
    // already-idempotent for NumPy specifically (its empty label means
    // `decorateFirstLine` degrades to pure whitespace either way), but
    // produced a `hangingIndent`-wide trailing-whitespace-only line
    // where the source had none -- see `../field-entries.ts`'s
    // `stripLeadingBlanks` for the fuller mechanism, shared with
    // `groupFieldEntries`.
    const text = [
      'Parameters',
      '----------',
      'x : int',
      '',
      '    Description after a blank line right under the header.',
    ].join('\n');
    const blocks = numpyDialect.segment(text, {});
    const entry = blocks[3];
    if (entry?.type !== 'fieldEntry') throw new Error('expected fieldEntry');
    expect(entry.blocks.map((b) => b.type)).toEqual(['paragraph']);
  });
});
