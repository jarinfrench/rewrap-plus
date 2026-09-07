import { beforeAll, describe, expect, it } from 'vitest';
import { createTestParserManager } from '../helpers/create-test-parser-manager.js';
import { applyTextEdits } from '../../src/apply-edits.js';
import { ParserManager } from '../../src/parser/parser-manager.js';
import type { WrapConfig } from '../../src/types/config.js';
import { cppAdapter } from '../../src/languages/cpp/adapter.js';
import { wrapRegions } from '../../src/wrap.js';

import doxygenIn from '../fixtures/cpp/doc-comments/001-doxygen-param-return.in.cpp?raw';
import doxygenOut from '../fixtures/cpp/doc-comments/001-doxygen-param-return.out.cpp?raw';
import plainIn from '../fixtures/cpp/doc-comments/002-plain-narrative.in.cpp?raw';
import plainOut from '../fixtures/cpp/doc-comments/002-plain-narrative.out.cpp?raw';
import tripleSlashIn from '../fixtures/cpp/doc-comments/003-triple-slash-param-return.in.cpp?raw';
import tripleSlashOut from '../fixtures/cpp/doc-comments/003-triple-slash-param-return.out.cpp?raw';
import markdownListIn from '../fixtures/cpp/doc-comments/004-doxygen-markdown-list.in.cpp?raw';
import markdownListOut from '../fixtures/cpp/doc-comments/004-doxygen-markdown-list.out.cpp?raw';

/**
 * Gold fixtures for `'docComment'` regions -- the Doxygen dialect
 * (`../../src/docs/doxygen.ts`) applied through `wrapDocComment`
 * (`../../src/comments/wrap-doc-comment.ts`), end to end via
 * `wrapRegions`. Mirrors this package's established fixture-driven
 * convention (`./javascript-doc-comment-wrap-fixtures.test.ts`).
 *
 * 003 covers Doxygen's `///` repeated-marker form specifically --
 * `wrapDocComment` dissolves/emits it through the same per-line
 * machinery a `'lineComment'` region uses (`comments.doc.repeatedMarker`),
 * not `emitBlockComments`'s open/close pair the way 001/002 do, so it's
 * exercising a genuinely different code path even though it produces the
 * same tag-aware Doxygen wrapping.
 *
 * 004 is a regression fixture for a bug reported against a different
 * regex-based Doxygen wrapper (dnut/rewrap-revived#52): a `-`-bulleted
 * markdown-style list immediately following prose, inside a `///`
 * comment, got collapsed into one run-on paragraph instead of staying
 * one list item per line. Confirmed non-reproducible here -- the shared
 * block splitter (`../../src/segmentation/split-blocks.ts`, list markers
 * via `./list-item.ts`) detects `-` list markers independently of
 * dialect, so Doxygen gets list-aware reflow for free rather than
 * needing its own bullet-parsing logic.
 */
const COLUMN_LIMIT = 60;

interface Fixture {
  readonly name: string;
  readonly input: string;
  readonly expected: string;
}

const fixtures: readonly Fixture[] = [
  { name: '001-doxygen-param-return', input: doxygenIn, expected: doxygenOut },
  { name: '002-plain-narrative', input: plainIn, expected: plainOut },
  { name: '003-triple-slash-param-return', input: tripleSlashIn, expected: tripleSlashOut },
  { name: '004-doxygen-markdown-list', input: markdownListIn, expected: markdownListOut },
];

function config(overrides: Partial<WrapConfig> = {}): WrapConfig {
  return {
    columnLimit: COLUMN_LIMIT,
    tabSize: 4,
    wrapComments: true,
    wrapStrings: true,
    stringPolicy: 'prose',
    docDialect: 'auto',
    preserveIndentedBlocks: false,
    balancedWrapping: false,
    ...overrides,
  };
}

let parserManager: ParserManager;

beforeAll(async () => {
  parserManager = await createTestParserManager(cppAdapter);
});

describe('C++ docComment (Doxygen) wrapping -- end-to-end gold fixtures', () => {
  it.each(fixtures.map((f) => [f.name, f] as const))('%s', async (_name, fixture) => {
    const result = await wrapRegions(fixture.input, 'cpp', 'all', config(), parserManager);
    const actual = applyTextEdits(fixture.input, result.edits);
    expect(actual).toBe(fixture.expected);
  });

  it('keeps \\param/\\return tags on their own lines, never merged with the summary', () => {
    expect(doxygenOut).toMatch(/\\param name/);
    expect(doxygenOut).toMatch(/\\return/);
  });

  it('falls back to plain paragraph reflow when no tag is present', () => {
    expect(plainOut).not.toMatch(/\\param|\\return|@param|@return/);
  });

  it('wraps a /// doc comment through the repeated-marker path, with every line prefixed', () => {
    expect(tripleSlashOut).toMatch(/\\param name/);
    expect(tripleSlashOut).toMatch(/\\return/);
    for (const line of tripleSlashOut.split(/\r?\n/).filter((line) => line.length > 0)) {
      if (line.startsWith('const char')) {
        continue; // the declaration line, not part of the comment
      }
      expect(line.startsWith('///')).toBe(true);
    }
  });

  it('produces no line over the column limit for any fixture', async () => {
    for (const fixture of fixtures) {
      const result = await wrapRegions(fixture.input, 'cpp', 'all', config(), parserManager);
      const actual = applyTextEdits(fixture.input, result.edits);
      for (const line of actual.split('\n')) {
        expect(line.length).toBeLessThanOrEqual(COLUMN_LIMIT);
      }
    }
  });

  it('keeps each `-` list item on its own line rather than collapsing the list into one paragraph (dnut/rewrap-revived#52)', () => {
    const listLines = markdownListOut.split(/\r?\n/).filter((line) => line.startsWith('/// -'));
    expect(listLines).toHaveLength(2);
    expect(listLines[0]).toMatch(/^\/\/\/ - `handle`/);
    expect(listLines[1]).toMatch(/^\/\/\/ - `deleter`/);
  });

  it('is idempotent: re-wrapping the gold output produces no further edits', async () => {
    for (const fixture of fixtures) {
      const result = await wrapRegions(fixture.expected, 'cpp', 'all', config(), parserManager);
      expect(result.edits).toEqual([]);
    }
  });
});
