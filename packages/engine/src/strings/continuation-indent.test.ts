import { describe, expect, it } from 'vitest';
import type { WrapConfig } from '../types/config.js';
import type { WrappableRegion } from '../types/region.js';
import { visualIndentColumn } from '../discovery/visual-indent-column.js';
import { continuationIndentColumns } from './continuation-indent.js';

const cfg: WrapConfig = {
  columnLimit: 80,
  tabSize: 4,
  wrapComments: true,
  wrapStrings: true,
  stringPolicy: 'prose',
  docDialect: 'auto',
  preserveIndentedBlocks: false,
  balancedWrapping: false,
};

/** A region starting at `startColumn` on the source's first line. */
function regionAt(source: string, startColumn: number): WrappableRegion {
  const line = source.split('\n')[0] ?? '';
  return {
    kind: 'stringLiteral',
    span: {
      startByte: startColumn,
      endByte: line.length,
      startRow: 0,
      startColumn,
      endRow: 0,
      endColumn: line.length,
    },
    parts: [],
    rawText: '',
    indentColumn: visualIndentColumn(line, startColumn, cfg.tabSize),
    languageId: 'javascript',
  };
}

describe('continuationIndentColumns', () => {
  it('aligns to the string itself when it starts its own line', () => {
    const source = '        "some text"\n';
    expect(continuationIndentColumns(regionAt(source, 8), source, cfg, false)).toBe(8);
  });

  it('tab-expands a tab-indented string starting its own line', () => {
    const source = '\t\t"some text"\n';
    expect(continuationIndentColumns(regionAt(source, 2), source, cfg, false)).toBe(8);
  });

  it('treats non-ASCII whitespace indentation as starting its own line', () => {
    const source = '      "some text"\n';
    expect(continuationIndentColumns(regionAt(source, 6), source, cfg, false)).toBe(6);
  });

  it("uses the statement's indent plus four for a string starting mid-line", () => {
    const source = '    message = "some text"\n';
    expect(continuationIndentColumns(regionAt(source, 14), source, cfg, false)).toBe(8);
    const call = '        log.warning("some text")\n';
    expect(continuationIndentColumns(regionAt(call, 20), call, cfg, false)).toBe(12);
  });

  it('falls back to indent plus four when needsParens is set, even on its own line', () => {
    const source = '    "some text"\n';
    expect(continuationIndentColumns(regionAt(source, 4), source, cfg, true)).toBe(8);
  });
});
