import type { Block } from '../types/document.js';
import type { SplitBlocksOptions } from '../segmentation/split-blocks.js';
import { toLines } from '../segmentation/to-lines.js';
import { leadingWhitespaceLength } from '../segmentation/verbatim.js';
import { type DocDialect, type DocEmitContext, reflowDocBlocks, segmentLines } from './dialect.js';
import { groupFieldEntries, type EntryStartMatch } from './field-entries.js';

/**
 * A Sphinx/reST field-list marker: `:field:` or `:field arg:`, flush
 * left — `:param x:`, `:type x:`, `:returns:`, `:rtype:`, `:raises
 * ValueError:`. Unlike Google/NumPy, Sphinx has no separate "section"
 * concept at all: every field marker is its own entry, and the field
 * list is conventionally just however many of these appear consecutively
 * (usually at the end of the docstring), not grouped under a header.
 */
const SPHINX_FIELD = /^:([\w-]+(?:\s+[^\s:][^:]*?)?):\s?(.*)$/;

function matchSphinxEntry(line: string): EntryStartMatch | null {
  if (leadingWhitespaceLength(line) !== 0) {
    return null;
  }
  const match = SPHINX_FIELD.exec(line);
  if (!match) {
    return null;
  }
  const [, field = '', rest = ''] = match;
  return { label: `:${field}:`, rest };
}

/**
 * Sphinx/reST field-list docstrings: a summary/description, then a flat
 * run of `:param x:`/`:returns:`/`:rtype:`/... entries — no section
 * headers, unlike Google or NumPy.
 */
export const sphinxDialect: DocDialect = {
  id: 'sphinx',

  /**
   * Confidence rises with the number of recognized field markers found,
   * saturating quickly — a single `:returns:` is already a strong,
   * distinctive signal (the leading-colon field-marker shape has no
   * ordinary-prose false-positive risk the way a bare Google `Name:`
   * line does), so even one match clears the halfway point.
   */
  detect(text: string): number {
    const fieldCount = toLines(text).filter((line) => matchSphinxEntry(line) !== null).length;
    return fieldCount === 0 ? 0 : Math.min(1, 0.5 + fieldCount * 0.2);
  },

  segment(text: string, options: SplitBlocksOptions): Block[] {
    const lines = toLines(text);
    const firstFieldIndex = lines.findIndex((line) => matchSphinxEntry(line) !== null);
    if (firstFieldIndex === -1) {
      return segmentLines(lines, options);
    }

    const prose = lines.slice(0, firstFieldIndex);
    const fieldLines = lines.slice(firstFieldIndex);
    return [...segmentLines(prose, options), ...groupFieldEntries(fieldLines, matchSphinxEntry)];
  },

  emit(blocks: readonly Block[], ctx: DocEmitContext): string[] {
    return reflowDocBlocks(blocks, ctx);
  },
};
