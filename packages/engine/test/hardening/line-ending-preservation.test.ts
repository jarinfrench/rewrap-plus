import { beforeAll, describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../../src/adapter-registry.js';
import { applyTextEdits } from '../../src/apply-edits.js';
import { ParserManager } from '../../src/parser/parser-manager.js';
import type { WrapConfig } from '../../src/types/config.js';
import { pythonAdapter } from '../../src/languages/python/adapter.js';
import { wrapRegions } from '../../src/wrap.js';

import commentsTrailing from '../fixtures/python/comments/001-trailing-comment-after-code.in.py?raw';
import commentsVaryingIndent from '../fixtures/python/comments/002-varying-indent-blocks.in.py?raw';
import commentsInsideFunction from '../fixtures/python/comments/003-comments-inside-function-body.in.py?raw';
import docstringsGoogle from '../fixtures/python/docstrings/002-google-style.in.py?raw';
import docstringsNumpy from '../fixtures/python/docstrings/003-numpy-style.in.py?raw';
import stringsLongProse from '../fixtures/python/strings/001-long-prose-message.in.py?raw';
import stringsRebalanced from '../fixtures/python/strings/002-existing-concat-rebalanced.in.py?raw';

/**
 * Line ending and trailing whitespace preservation.
 *
 * `detect-line-ending.test.ts` unit-tests `detectLineEndingNear` itself;
 * this file exercises it end to end through `wrapRegions`, plus the two
 * other preservation properties ("trailing whitespace, and file-final
 * newline preserved") across the *real* gold fixtures (comments,
 * docstrings, and strings together), not just the conformance kit's own
 * small synthetic sources.
 */
const cfg: WrapConfig = {
  columnLimit: 30,
  tabSize: 4,
  wrapComments: true,
  wrapStrings: true,
  stringPolicy: 'all',
  docDialect: 'auto',
  preserveIndentedBlocks: true,
  balancedWrapping: false,
};

const engineRoot = '.';

let parserManager: ParserManager;

beforeAll(async () => {
  const registry = new AdapterRegistry();
  registry.register(pythonAdapter);
  parserManager = await ParserManager.create({ wasmDir: engineRoot, registry });
});

describe('line-ending preservation', () => {
  it("each region's own edit matches the line-ending convention actually surrounding it in a genuinely mixed-CRLF/LF file", async () => {
    // First half of the file is CRLF-terminated, second half LF — a
    // shape `detectLineEnding`'s own whole-file heuristic can't handle
    // correctly (it would pick whichever comes first and apply it
    // everywhere). Two long comments, one in each half, both needing to
    // wrap under the column limit above.
    const crlfComment = '# ' + 'crlf word '.repeat(6).trim();
    const lfComment = '# ' + 'lf word '.repeat(6).trim();
    const crlfPart = `${crlfComment}\r\nx = 1\r\n\r\n`;
    const lfPart = `${lfComment}\ny = 2\n`;
    const source = crlfPart + lfPart;

    const result = await wrapRegions(source, 'python', 'all', cfg, parserManager);
    expect(result.edits).toHaveLength(2);

    const crlfEdit = result.edits.find((e) => e.span.startRow === 0)!;
    const lfEdit = result.edits.find((e) => e.span.startRow > 0)!;

    expect(crlfEdit.newText).toContain('\r\n');
    expect(crlfEdit.newText).not.toMatch(/[^\r]\n/);
    expect(lfEdit.newText).not.toContain('\r');
  });

  it('never introduces trailing whitespace on any wrapped line, across the real comment/docstring/string gold fixtures', async () => {
    const sources = [
      commentsTrailing,
      commentsVaryingIndent,
      commentsInsideFunction,
      docstringsGoogle,
      docstringsNumpy,
      stringsLongProse,
      stringsRebalanced,
    ];

    for (const source of sources) {
      const result = await wrapRegions(source, 'python', 'all', cfg, parserManager);
      const wrapped = applyTextEdits(source, result.edits);
      for (const line of wrapped.split(/\r?\n/)) {
        expect(line).not.toMatch(/[ \t]$/);
      }
    }
  });

  it("preserves whether the source ends in a trailing newline, across the real comment/docstring/string gold fixtures", async () => {
    const sources = [
      commentsTrailing,
      commentsVaryingIndent,
      commentsInsideFunction,
      docstringsGoogle,
      docstringsNumpy,
      stringsLongProse,
      stringsRebalanced,
    ];

    for (const source of sources) {
      const result = await wrapRegions(source, 'python', 'all', cfg, parserManager);
      const wrapped = applyTextEdits(source, result.edits);
      expect(/\n$/.test(wrapped)).toBe(/\n$/.test(source));
    }
  });
});
