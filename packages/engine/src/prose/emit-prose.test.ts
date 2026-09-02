import { describe, expect, it } from 'vitest';
import type { Atom, LogicalDocument } from '../types/document.js';
import { atomizeWords } from '../segmentation/atomize-words.js';
import { dissolveProse } from './dissolve-prose.js';
import { emitProse } from './emit-prose.js';

function doc(atoms: readonly Atom[], indentColumn = 0): LogicalDocument {
  return { blocks: [{ type: 'paragraph', atoms }], meta: { indentColumn } };
}

describe('emitProse — line 1 vs continuation prefix', () => {
  it('emits the first line bare, with no continuation prefix', () => {
    const document = doc(atomizeWords('hello world'));
    expect(emitProse(document, 80, { continuationPrefix: '> ' })).toBe('hello world');
  });

  it('prepends continuationPrefix to every line after the first', () => {
    // Force a wrap onto two lines with a narrow column limit.
    const document = doc(atomizeWords('one two three four'));
    const out = emitProse(document, 8, { continuationPrefix: '> ' });
    const lines = out.split('\n');

    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]!.startsWith('> ')).toBe(false);
    for (const line of lines.slice(1)) {
      expect(line.startsWith('> ')).toBe(true);
    }
  });

  it('never spells out any prefix for a single-line result', () => {
    const document = doc(atomizeWords('short'));
    expect(emitProse(document, 80, { continuationPrefix: '>>>> ' })).toBe('short');
  });
});

describe('emitProse — column budget', () => {
  it('reflows to columnLimit - indentColumn, uniformly for every line', () => {
    const document = doc(atomizeWords('aaaa bbbb cccc dddd'), 4);
    // columnLimit 10, indentColumn 4 -> availableWidth 6 for every line.
    const out = emitProse(document, 10, { continuationPrefix: '' });
    for (const line of out.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(6);
    }
  });

  it('never computes a non-positive budget for a deeply indented region', () => {
    const document = doc(atomizeWords('word'), 1000);
    expect(() => emitProse(document, 80, { continuationPrefix: '' })).not.toThrow();
  });
});

describe('emitProse — breakBefore forces a fresh (prefixed) line', () => {
  it('starts a new, prefixed line at a breakBefore atom even when the current line has room', () => {
    const atoms: Atom[] = [
      { text: 'aaa', width: 3, breakBefore: false },
      { text: 'bbb', width: 3, breakBefore: true },
    ];
    const document = doc(atoms);
    // Plenty of width for both words on one line — only breakBefore
    // should force the split.
    const out = emitProse(document, 80, { continuationPrefix: '| ' });

    expect(out).toBe('aaa\n| bbb');
  });
});

describe('emitProse — dissolveProse round trip (hard breaks survive as real trailing whitespace)', () => {
  it('preserves a two-space hard break as trailing whitespace on its output line', () => {
    const region = {
      kind: 'prose' as const,
      span: { startByte: 0, endByte: 0, startRow: 0, startColumn: 0, endRow: 1, endColumn: 8 },
      parts: [
        { startByte: 0, endByte: 0, startRow: 0, startColumn: 0, endRow: 0, endColumn: 10 },
        { startByte: 0, endByte: 0, startRow: 1, startColumn: 0, endRow: 1, endColumn: 8 },
      ],
      rawText: 'line one  \nline two',
      indentColumn: 0,
      languageId: 'prose-test',
    };
    const source = 'line one  \nline two\n';
    const document = dissolveProse(region, source, { hardBreak: [/[ ]{2,}$/] });

    const out = emitProse(document, 80, { continuationPrefix: '' });

    expect(out).toBe('line one  \nline two');
  });
});
