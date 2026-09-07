import { describe, expect, it } from 'vitest';
import type { Block } from '../types/document.js';
import { commentBasedHelpDialect } from './comment-based-help.js';

function sectionHeader(blocks: readonly Block[], index: number) {
  const block = blocks[index];
  if (block?.type !== 'sectionHeader')
    throw new Error(`expected sectionHeader at ${index}, got ${block?.type}`);
  return block;
}

function paragraph(blocks: readonly Block[], index: number) {
  const block = blocks[index];
  if (block?.type !== 'paragraph') throw new Error(`expected paragraph at ${index}, got ${block?.type}`);
  return block;
}

describe('commentBasedHelpDialect.detect', () => {
  it('scores plain prose with no .Tag lines at 0', () => {
    expect(commentBasedHelpDialect.detect('Just a summary.\n\nMore description.')).toBe(0);
  });

  it('scores text with a recognized .SYNOPSIS tag above 0', () => {
    expect(commentBasedHelpDialect.detect('.SYNOPSIS\nDoes a thing.')).toBeGreaterThan(0);
  });

  it('does not treat an indented ".PARAMETER"-like line as a tag', () => {
    expect(commentBasedHelpDialect.detect('    .PARAMETER Name\nnested inside something else')).toBe(0);
  });

  it('does not treat an unrecognized .word as a tag — only the fixed known vocabulary counts', () => {
    // Real prose can start a line with a period-prefixed word (".NET",
    // a sentence continuation) — KNOWN_TAGS's fixed vocabulary is what
    // keeps this dialect from misreading that as help-tag structure.
    expect(commentBasedHelpDialect.detect('.NET is a runtime, not a PowerShell help tag.')).toBe(0);
  });

  it('is case-insensitive about the tag name itself', () => {
    expect(commentBasedHelpDialect.detect('.synopsis\nlowercase still counts')).toBeGreaterThan(0);
  });
});

describe('commentBasedHelpDialect.segment', () => {
  it('segments a preamble-free flat run of .Tag sections', () => {
    const text = ['.SYNOPSIS', 'Does a thing.', '.DESCRIPTION', 'Does it in detail.'].join('\n');
    const blocks = commentBasedHelpDialect.segment(text, {});
    expect(blocks.map((b) => b.type)).toEqual(['sectionHeader', 'paragraph', 'sectionHeader', 'paragraph']);
    expect(sectionHeader(blocks, 0).text).toBe('.SYNOPSIS');
    expect(paragraph(blocks, 1).atoms.map((a) => a.text)).toEqual(['Does', 'a', 'thing.']);
    expect(sectionHeader(blocks, 2).text).toBe('.DESCRIPTION');
    expect(paragraph(blocks, 3).atoms.map((a) => a.text)).toEqual(['Does', 'it', 'in', 'detail.']);
  });

  it("keeps .PARAMETER's own inline name as part of the header line, not parsed out", () => {
    // The identical "don't hardcode a per-tag argument grammar" call
    // ../docs/jsdoc.ts already makes for `@param {Type} name` — see
    // ./comment-based-help.ts's own doc comment.
    const text = ['.PARAMETER Name', 'The name of the thing.'].join('\n');
    const blocks = commentBasedHelpDialect.segment(text, {});
    expect(sectionHeader(blocks, 0).text).toBe('.PARAMETER Name');
    expect(paragraph(blocks, 1).atoms.map((a) => a.text)).toEqual([
      'The',
      'name',
      'of',
      'the',
      'thing.',
    ]);
  });

  it('folds a multi-line description into one reflowable paragraph', () => {
    const text = ['.SYNOPSIS', 'First line of the summary', 'continues on a second line.'].join('\n');
    const blocks = commentBasedHelpDialect.segment(text, {});
    expect(paragraph(blocks, 1).atoms.map((a) => a.text)).toEqual([
      'First',
      'line',
      'of',
      'the',
      'summary',
      'continues',
      'on',
      'a',
      'second',
      'line.',
    ]);
  });

  it('falls back to plain prose when there is no .Tag at all', () => {
    const blocks = commentBasedHelpDialect.segment('Just a summary with no tags.', {});
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe('paragraph');
  });

  it('keeps a prose preamble ahead of the first .Tag section', () => {
    const text = ['A short preamble.', '', '.SYNOPSIS', 'Does a thing.'].join('\n');
    const blocks = commentBasedHelpDialect.segment(text, {});
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'blank', 'sectionHeader', 'paragraph']);
  });

  it('preserves a blank line between two .Tag sections', () => {
    const text = ['.SYNOPSIS', 'Does a thing.', '', '.DESCRIPTION', 'Does it in detail.'].join('\n');
    const blocks = commentBasedHelpDialect.segment(text, {});
    expect(blocks.map((b) => b.type)).toEqual([
      'sectionHeader',
      'paragraph',
      'blank',
      'sectionHeader',
      'paragraph',
    ]);
  });

  it('handles the full real tag vocabulary', () => {
    const text = [
      '.SYNOPSIS',
      'a',
      '.DESCRIPTION',
      'b',
      '.PARAMETER Name',
      'c',
      '.EXAMPLE',
      'd',
      '.INPUTS',
      'e',
      '.OUTPUTS',
      'f',
      '.NOTES',
      'g',
      '.LINK',
      'h',
      '.COMPONENT',
      'i',
      '.ROLE',
      'j',
      '.FUNCTIONALITY',
      'k',
    ].join('\n');
    const blocks = commentBasedHelpDialect.segment(text, {});
    const headers = blocks.filter((b) => b.type === 'sectionHeader').map((b) => b.text);
    expect(headers).toEqual([
      '.SYNOPSIS',
      '.DESCRIPTION',
      '.PARAMETER Name',
      '.EXAMPLE',
      '.INPUTS',
      '.OUTPUTS',
      '.NOTES',
      '.LINK',
      '.COMPONENT',
      '.ROLE',
      '.FUNCTIONALITY',
    ]);
  });
});
