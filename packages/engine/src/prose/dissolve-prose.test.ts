import { describe, expect, it } from 'vitest';
import type { SourceSpan } from '../types/span.js';
import type { WrappableRegion } from '../types/region.js';
import { dissolveProse, type ProseSpec } from './dissolve-prose.js';

/**
 * Hand-build a `'prose'` region and its backing source from a list of
 * physical lines — `WrappableRegion.parts`' contract is one entry per
 * physical line, with the region's own container prefix already
 * excluded, so each part here is simply that whole line: this module's
 * own tests exercise `dissolveProse` directly rather than through a real
 * Markdown/LaTeX grammar, and none of this module's own logic needs
 * one — it only needs `region.parts`/`region.indentColumn`
 * and `source`, the same "hand-built regions" convention
 * `comments/*.test.ts` already uses for engine-level unit tests.
 */
function buildRegion(
  lines: readonly string[],
  indentColumn = 0,
): { readonly region: WrappableRegion; readonly source: string } {
  const source = lines.join('\n') + '\n';
  const parts: SourceSpan[] = lines.map((line, row) => ({
    startByte: 0,
    endByte: 0,
    startRow: row,
    startColumn: 0,
    endRow: row,
    endColumn: line.length,
  }));
  const region: WrappableRegion = {
    kind: 'prose',
    span: parts[0] ? { ...parts[0]!, endRow: parts.length - 1, endColumn: lines.at(-1)?.length ?? 0 } : parts[0]!,
    parts,
    rawText: lines.join('\n'),
    indentColumn,
    languageId: 'prose-test',
  };
  return { region, source };
}

const MARKDOWN_HARD_BREAK: ProseSpec['hardBreak'] = [/(\\|[ ]{2,}|<br\s*\/?>)$/i];

describe('dissolveProse', () => {
  it('produces exactly one paragraph block', () => {
    const { region, source } = buildRegion(['hello world']);
    const document = dissolveProse(region, source, { hardBreak: [] });

    expect(document.blocks).toHaveLength(1);
    expect(document.blocks[0]!.type).toBe('paragraph');
  });

  it('carries region.indentColumn through as DocMeta.indentColumn', () => {
    const { region, source } = buildRegion(['hello'], 4);
    const document = dissolveProse(region, source, { hardBreak: [] });

    expect(document.meta.indentColumn).toBe(4);
  });

  it('atomizes a single line the same way atomizeWords would', () => {
    const { region, source } = buildRegion(['hello world']);
    const document = dissolveProse(region, source, { hardBreak: [] });
    const block = document.blocks[0]!;
    if (block.type !== 'paragraph') throw new Error('expected a paragraph block');

    expect(block.atoms.map((a) => a.text)).toEqual(['hello', 'world']);
    expect(block.atoms.every((a) => a.breakBefore === false)).toBe(true);
  });

  it('concatenates multiple lines into one flat atom stream with no special handling at ordinary line boundaries', () => {
    const { region, source } = buildRegion(['first line', 'second line']);
    const document = dissolveProse(region, source, { hardBreak: [] });
    const block = document.blocks[0]!;
    if (block.type !== 'paragraph') throw new Error('expected a paragraph block');

    expect(block.atoms.map((a) => a.text)).toEqual(['first', 'line', 'second', 'line']);
    // No atom carries breakBefore or unusual glue purely from crossing a
    // source line boundary — reflow is free to join these as if the
    // source had been one long line.
    expect(block.atoms.every((a) => a.breakBefore === false)).toBe(true);
    expect(block.atoms.every((a) => a.glue === undefined)).toBe(true);
  });

  it('keeps a two-space hard break on the preceding line\'s last atom and counts it as width', () => {
    const { region, source } = buildRegion(['line one  ', 'line two']);
    const document = dissolveProse(region, source, { hardBreak: MARKDOWN_HARD_BREAK });
    const block = document.blocks[0]!;
    if (block.type !== 'paragraph') throw new Error('expected a paragraph block');

    const oneAtoms = block.atoms.slice(0, 2);
    expect(oneAtoms.map((a) => a.text)).toEqual(['line', 'one  ']);
    expect(oneAtoms[1]!.width).toBe('one'.length + 2);
  });

  it('tags the following line\'s first atom breakBefore: true after a hard break', () => {
    const { region, source } = buildRegion(['line one  ', 'line two']);
    const document = dissolveProse(region, source, { hardBreak: MARKDOWN_HARD_BREAK });
    const block = document.blocks[0]!;
    if (block.type !== 'paragraph') throw new Error('expected a paragraph block');

    const twoAtoms = block.atoms.slice(2);
    expect(twoAtoms.map((a) => a.text)).toEqual(['line', 'two']);
    expect(twoAtoms[0]!.breakBefore).toBe(true);
    expect(twoAtoms[1]!.breakBefore).toBe(false);
  });

  it('recognizes a trailing backslash as a hard break', () => {
    const { region, source } = buildRegion(['line one\\', 'line two']);
    const document = dissolveProse(region, source, { hardBreak: MARKDOWN_HARD_BREAK });
    const block = document.blocks[0]!;
    if (block.type !== 'paragraph') throw new Error('expected a paragraph block');

    expect(block.atoms[1]!.text).toBe('one\\');
    expect(block.atoms[2]!.breakBefore).toBe(true);
  });

  it('recognizes an HTML <br> as a hard break', () => {
    const { region, source } = buildRegion(['line one<br>', 'line two']);
    const document = dissolveProse(region, source, { hardBreak: MARKDOWN_HARD_BREAK });
    const block = document.blocks[0]!;
    if (block.type !== 'paragraph') throw new Error('expected a paragraph block');

    expect(block.atoms[1]!.text).toBe('one<br>');
    expect(block.atoms[2]!.breakBefore).toBe(true);
  });

  it('does not treat an ordinary line ending as a hard break', () => {
    const { region, source } = buildRegion(['line one', 'line two']);
    const document = dissolveProse(region, source, { hardBreak: MARKDOWN_HARD_BREAK });
    const block = document.blocks[0]!;
    if (block.type !== 'paragraph') throw new Error('expected a paragraph block');

    expect(block.atoms.map((a) => a.text)).toEqual(['line', 'one', 'line', 'two']);
    expect(block.atoms.every((a) => a.breakBefore === false)).toBe(true);
  });

  it('propagates breakBefore across consecutive hard-break lines', () => {
    const { region, source } = buildRegion(['a  ', 'b  ', 'c']);
    const document = dissolveProse(region, source, { hardBreak: MARKDOWN_HARD_BREAK });
    const block = document.blocks[0]!;
    if (block.type !== 'paragraph') throw new Error('expected a paragraph block');

    expect(block.atoms.map((a) => a.text)).toEqual(['a  ', 'b  ', 'c']);
    expect(block.atoms.map((a) => a.breakBefore)).toEqual([false, true, true]);
  });

  it('never sets breakBefore on the very first atom of the region', () => {
    const { region, source } = buildRegion(['a  ', 'b']);
    const document = dissolveProse(region, source, { hardBreak: MARKDOWN_HARD_BREAK });
    const block = document.blocks[0]!;
    if (block.type !== 'paragraph') throw new Error('expected a paragraph block');

    expect(block.atoms[0]!.breakBefore).toBe(false);
  });

  it('does not propagate breakBefore past a line with no hard break', () => {
    const { region, source } = buildRegion(['a  ', 'b', 'c']);
    const document = dissolveProse(region, source, { hardBreak: MARKDOWN_HARD_BREAK });
    const block = document.blocks[0]!;
    if (block.type !== 'paragraph') throw new Error('expected a paragraph block');

    expect(block.atoms.map((a) => a.text)).toEqual(['a  ', 'b', 'c']);
    expect(block.atoms.map((a) => a.breakBefore)).toEqual([false, true, false]);
  });

  it('synthesizes an atom for a hard-break marker on a line with no other content', () => {
    const { region, source } = buildRegion(['  ', 'next line']);
    const document = dissolveProse(region, source, { hardBreak: MARKDOWN_HARD_BREAK });
    const block = document.blocks[0]!;
    if (block.type !== 'paragraph') throw new Error('expected a paragraph block');

    expect(block.atoms[0]!.text).toBe('  ');
    expect(block.atoms[1]!.breakBefore).toBe(true);
  });

  it('threads extraUnbreakable through to every line\'s atomization', () => {
    const verb = /\\verb\*?(.)[^\n]*?\1/;
    const { region, source } = buildRegion(['see \\verb|a b c| now']);
    const document = dissolveProse(region, source, { hardBreak: [], extraUnbreakable: [verb] });
    const block = document.blocks[0]!;
    if (block.type !== 'paragraph') throw new Error('expected a paragraph block');

    expect(block.atoms.map((a) => a.text)).toEqual(['see', '\\verb|a b c|', 'now']);
  });

  it('uses the first hardBreak pattern, in declaration order, that matches', () => {
    // Two patterns that both match somewhere at the end of the line, but
    // consume different amounts of it — `narrow` (just the trailing two
    // spaces) leaves "bbb" to be atomized normally before the marker is
    // reattached; `wide` (from "bbb" through the trailing spaces) would
    // instead swallow "bbb" into the marker text itself with no atom
    // boundary. The two produce genuinely different results, so which
    // one wins is directly observable.
    const { region, source } = buildRegion(['aaa bbb  ']);
    const narrow = /[ ]{2,}$/;
    const wide = /bbb {2,}$/;

    const narrowFirst = dissolveProse(region, source, { hardBreak: [narrow, wide] }).blocks[0]!;
    const wideFirst = dissolveProse(region, source, { hardBreak: [wide, narrow] }).blocks[0]!;
    if (narrowFirst.type !== 'paragraph' || wideFirst.type !== 'paragraph') {
      throw new Error('expected paragraph blocks');
    }

    expect(narrowFirst.atoms.map((a) => a.text)).toEqual(['aaa', 'bbb  ']);
    expect(wideFirst.atoms.map((a) => a.text)).toEqual(['aaabbb  ']);
  });
});
