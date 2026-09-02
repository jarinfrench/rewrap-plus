import { Parser, Language } from 'web-tree-sitter';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Tree } from '../../types/tree-sitter-types.js';
import { discoverMarkdownProse } from './discover-prose.js';

const grammarPath = 'grammars/tree-sitter-markdown.wasm';

let parser: Parser;

beforeAll(async () => {
  await Parser.init();
  const language = await Language.load(grammarPath);
  parser = new Parser();
  parser.setLanguage(language);
});

function parse(source: string): Tree {
  const tree = parser.parse(source);
  if (!tree) {
    throw new Error(`test setup: parser.parse returned null for ${JSON.stringify(source)}`);
  }
  return tree;
}

function partsText(source: string, region: ReturnType<typeof discoverMarkdownProse>[number]): string[] {
  const lines = source.split('\n');
  return region.parts.map((part) => (lines[part.startRow] ?? '').slice(part.startColumn, part.endColumn));
}

describe('discoverMarkdownProse — basic geometry', () => {
  it('discovers a single-line paragraph as one region with the whole line as its one part', () => {
    const source = 'hello world\n';
    const regions = discoverMarkdownProse(parse(source), source, 'markdown', {});

    expect(regions).toHaveLength(1);
    expect(regions[0]!.kind).toBe('prose');
    expect(regions[0]!.parts).toHaveLength(1);
    expect(partsText(source, regions[0]!)).toEqual(['hello world']);
    expect(regions[0]!.languageId).toBe('markdown');
  });

  it('handles a paragraph with no trailing newline (end of file)', () => {
    const source = 'hello world';
    const regions = discoverMarkdownProse(parse(source), source, 'markdown', {});

    expect(regions).toHaveLength(1);
    expect(partsText(source, regions[0]!)).toEqual(['hello world']);
  });

  it('discovers multiple independent paragraphs, sorted by position', () => {
    const source = 'first paragraph\n\nsecond paragraph\n';
    const regions = discoverMarkdownProse(parse(source), source, 'markdown', {});

    expect(regions).toHaveLength(2);
    expect(partsText(source, regions[0]!)).toEqual(['first paragraph']);
    expect(partsText(source, regions[1]!)).toEqual(['second paragraph']);
  });

  it('excludes the block-quote marker from every part, including on continuation lines', () => {
    const source = '> line one\n> line two\n';
    const regions = discoverMarkdownProse(parse(source), source, 'markdown', {});

    expect(partsText(source, regions[0]!)).toEqual(['line one', 'line two']);
  });

  it('excludes a nested ">> " marker chain from every part', () => {
    const source = '>> line one\n>> line two\n';
    const regions = discoverMarkdownProse(parse(source), source, 'markdown', {});

    expect(partsText(source, regions[0]!)).toEqual(['line one', 'line two']);
  });

  it('excludes a list marker and its hanging indent from every part', () => {
    const source = '- line one\n  line two\n';
    const regions = discoverMarkdownProse(parse(source), source, 'markdown', {});

    expect(partsText(source, regions[0]!)).toEqual(['line one', 'line two']);
  });

  it('excludes an ordered-list marker from the first line', () => {
    const source = '1. line one\n   line two\n';
    const regions = discoverMarkdownProse(parse(source), source, 'markdown', {});

    expect(partsText(source, regions[0]!)).toEqual(['line one', 'line two']);
  });

  it('excludes a task-list checkbox from the first line', () => {
    const source = '- [ ] line one\n  line two\n';
    const regions = discoverMarkdownProse(parse(source), source, 'markdown', {});

    expect(partsText(source, regions[0]!)).toEqual(['line one', 'line two']);
  });

  it('leaves a lazy continuation line (no container marker) starting at column 0', () => {
    const source = '> hello world\nsecond line lazily continues\n';
    const regions = discoverMarkdownProse(parse(source), source, 'markdown', {});

    const [region] = regions;
    expect(region!.parts[1]!.startColumn).toBe(0);
    expect(partsText(source, region!)).toEqual(['hello world', 'second line lazily continues']);
  });

  it('excludes trailing \\r from every part on CRLF input', () => {
    const source = 'line one\r\nline two\r\nline three\r\n';
    const regions = discoverMarkdownProse(parse(source), source, 'markdown', {});

    for (const text of partsText(source, regions[0]!)) {
      expect(text).not.toContain('\r');
    }
    expect(partsText(source, regions[0]!)).toEqual(['line one', 'line two', 'line three']);
  });

  it('computes indentColumn with tabs expanded, from the first line only', () => {
    const source = '-\thello world\n\tsecond line\n';
    const regions = discoverMarkdownProse(parse(source), source, 'markdown', {});

    // list marker "-" (1 col) + tab expands to the next 4-stop (3 more cols).
    expect(regions[0]!.indentColumn).toBe(4);
  });

  it('respects an explicit tabSize option', () => {
    const source = '-\thello world\n';
    const regions = discoverMarkdownProse(parse(source), source, 'markdown', { tabSize: 2 });

    expect(regions[0]!.indentColumn).toBe(2);
  });

  it("builds region.span from the first part's start to the last part's end", () => {
    const source = '> line one\n> line two\n';
    const regions = discoverMarkdownProse(parse(source), source, 'markdown', {});
    const [region] = regions;

    expect(region!.span.startByte).toBe(region!.parts[0]!.startByte);
    expect(region!.span.endByte).toBe(region!.parts[region!.parts.length - 1]!.endByte);
  });

  it('joins rawText from each part\'s own (prefix-excluded) content', () => {
    const source = '> line one\n> line two\n';
    const regions = discoverMarkdownProse(parse(source), source, 'markdown', {});

    expect(regions[0]!.rawText).toBe('line one\nline two');
  });
});

describe('discoverMarkdownProse — §5.2 exclusions', () => {
  it('excludes a setext heading\'s own text', () => {
    const source = 'Heading Text\n============\n\nBody paragraph.\n';
    const regions = discoverMarkdownProse(parse(source), source, 'markdown', {});

    expect(regions).toHaveLength(1);
    expect(partsText(source, regions[0]!)).toEqual(['Body paragraph.']);
  });

  it('excludes a footnote definition\'s opening paragraph', () => {
    const source = '[^note]: this is a footnote definition body\nsecond line of it\n';
    const regions = discoverMarkdownProse(parse(source), source, 'markdown', {});

    expect(regions).toEqual([]);
  });

  it('does not exclude an ordinary paragraph that merely contains "[^...]" mid-sentence', () => {
    const source = 'See the note[^note] for details, which continues on this line.\n';
    const regions = discoverMarkdownProse(parse(source), source, 'markdown', {});

    expect(regions).toHaveLength(1);
  });

  it('excludes a paragraph containing a bare "$$" line (display math)', () => {
    const source = 'before\n$$\nx^2\n$$\nafter\n';
    const regions = discoverMarkdownProse(parse(source), source, 'markdown', {});

    expect(regions).toEqual([]);
  });

  it('excludes a paragraph containing a line that begins with "$$" but has trailing content', () => {
    const source = 'before\n$$ \\begin{aligned}\nx^2\n\\end{aligned}$$\n';
    const regions = discoverMarkdownProse(parse(source), source, 'markdown', {});

    expect(regions).toEqual([]);
  });

  it('does not exclude an ordinary paragraph merely mentioning a single "$" price', () => {
    const source = 'This costs $5 and that costs $6, which is a fine ordinary sentence.\n';
    const regions = discoverMarkdownProse(parse(source), source, 'markdown', {});

    expect(regions).toHaveLength(1);
  });
});

describe('discoverMarkdownProse — §5.6 verbatim node types produce no region', () => {
  it.each([
    ['atx heading', '# A Heading\n'],
    ['fenced code block', '```\ncode here\n```\n'],
    ['indented code block', '    code here\n'],
    ['html block', '<div>\nsome html\n</div>\n'],
    ['html comment', '<!-- a comment -->\n'],
    ['pipe table', '| a | b |\n|---|---|\n| 1 | 2 |\n'],
    ['thematic break', '---\n'],
    ['link reference definition', '[label]: https://example.com\n'],
    ['yaml front matter', '---\ntitle: Test\n---\n'],
    ['toml front matter', '+++\ntitle = "Test"\n+++\n'],
  ])('%s produces no prose region', (_name, source) => {
    const regions = discoverMarkdownProse(parse(source), source, 'markdown', {});
    expect(regions).toEqual([]);
  });

  it('a table interrupting a paragraph splits into a region for the text and nothing for the table', () => {
    const source = 'some text\n| a | b |\n|---|---|\n';
    const regions = discoverMarkdownProse(parse(source), source, 'markdown', {});

    expect(regions).toHaveLength(1);
    expect(partsText(source, regions[0]!)).toEqual(['some text']);
  });
});
