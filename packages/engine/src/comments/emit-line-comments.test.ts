import { Parser, Language } from 'web-tree-sitter';
import { beforeAll, describe, expect, it } from 'vitest';
import { discoverRegions } from '../discovery/discover-regions.js';
import type { LogicalDocument } from '../types/document.js';
import { pythonAdapter } from '../languages/python/adapter.js';
import { pythonDescriptor } from '../languages/python/descriptor.js';
import { dissolveLineComments } from './dissolve-line-comments.js';
import { emitLineComments } from './emit-line-comments.js';

const grammarPath = 'grammars/tree-sitter-python.wasm';
const MARKER = pythonDescriptor.comments.line!.marker;

let parser: Parser;

beforeAll(async () => {
  await Parser.init();
  const language = await Language.load(grammarPath);
  parser = new Parser();
  parser.setLanguage(language);
});

/** Round-trip a source snippet's sole comment region through dissolve, reflow, and emit. */
function wrapComment(source: string, columnLimit: number): string {
  const tree = parser.parse(source)!;
  const [region] = discoverRegions(pythonAdapter, tree, source, 'python');
  if (!region) {
    throw new Error(`test setup: no region discovered in '${source}'`);
  }
  const dissolved = dissolveLineComments(region, source, pythonDescriptor);
  return emitLineComments(dissolved.document, columnLimit, MARKER, dissolved.spaceAfterMarker);
}

function doc(blocks: LogicalDocument['blocks'], indentColumn = 0): LogicalDocument {
  return { blocks, meta: { indentColumn } };
}

describe('emitLineComments -- marker and spacing', () => {
  it('adds a space after the marker when spaceAfterMarker is true', () => {
    const document = doc([
      { type: 'paragraph', atoms: [{ text: 'hello', width: 5, breakBefore: false }] },
    ]);
    expect(emitLineComments(document, 80, '#', true)).toBe('# hello');
  });

  it('omits the space after the marker when spaceAfterMarker is false', () => {
    const document = doc([
      { type: 'paragraph', atoms: [{ text: 'hello', width: 5, breakBefore: false }] },
    ]);
    expect(emitLineComments(document, 80, '#', false)).toBe('#hello');
  });

  it('emits a bare marker for a blank block, with no trailing space', () => {
    const document = doc([{ type: 'blank' }]);
    expect(emitLineComments(document, 80, '#', true)).toBe('#');
  });

  it('passes verbatim block lines through unchanged except for indentation', () => {
    const document = doc([{ type: 'verbatim', lines: ['# noqa: E501'] }]);
    expect(emitLineComments(document, 80, '#', true)).toBe('# noqa: E501');
  });

  it("restores a listItem block's bullet marker rather than dropping it", () => {
    const document = doc([
      {
        type: 'listItem',
        marker: '-',
        hangingIndent: 2,
        atoms: [{ text: 'one', width: 3, breakBefore: false }],
      },
    ]);
    expect(emitLineComments(document, 80, '#', true)).toBe('# - one');
  });
});

describe('emitLineComments -- indentation', () => {
  it('does not spell out indentation on the first line', () => {
    const document = doc(
      [{ type: 'paragraph', atoms: [{ text: 'hi', width: 2, breakBefore: false }] }],
      4,
    );
    expect(emitLineComments(document, 80, '#', true)).toBe('# hi');
  });

  it('spells out indentation on every line after the first', () => {
    const document = doc(
      [
        { type: 'blank' },
        { type: 'paragraph', atoms: [{ text: 'hi', width: 2, breakBefore: false }] },
      ],
      4,
    );
    expect(emitLineComments(document, 80, '#', true)).toBe('#\n    # hi');
  });
});

describe('emitLineComments -- reflow round-trip via dissolve', () => {
  it('reproduces a single short comment line unchanged', () => {
    expect(wrapComment('# a short comment\n', 40)).toBe('# a short comment');
  });

  it('reproduces a spaceless comment line unchanged', () => {
    expect(wrapComment('#nospace\n', 40)).toBe('#nospace');
  });

  it('wraps a long comment across multiple lines within the column limit', () => {
    const source = '# ' + 'word '.repeat(20).trim() + '\n'; // far longer than 20 columns
    const result = wrapComment(source, 20);
    const lines = result.split('\n');
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(20);
    }
    // every line still starts with the marker
    expect(lines.every((line) => line.startsWith('#'))).toBe(true);
  });

  it('leaves a directive comment untouched even when it exceeds the column limit', () => {
    const long = '# noqa: ' + 'E501,'.repeat(20);
    const result = wrapComment(long + '\n', 20);
    expect(result).toBe(long);
  });

  it('leaves commented-out code untouched even when it exceeds the column limit', () => {
    const source =
      '# def old_function(argument_one, argument_two, argument_three):\n' +
      '#     return argument_one + argument_two + argument_three\n';
    const result = wrapComment(source, 20);
    expect(result).toBe(
      '# def old_function(argument_one, argument_two, argument_three):\n' +
        '#     return argument_one + argument_two + argument_three',
    );
  });
});
