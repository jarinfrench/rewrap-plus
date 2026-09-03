import { Parser, Language } from 'web-tree-sitter';
import { beforeAll, describe, expect, it } from 'vitest';
import { discoverRegions } from '../../discovery/discover-regions.js';
import { sliceSpanText } from '../../discovery/slice-span.js';
import { latexAdapter } from './adapter.js';

let parser: Parser;

beforeAll(async () => {
  await Parser.init();
  parser = new Parser();
  parser.setLanguage(await Language.load('grammars/tree-sitter-latex.wasm'));
});

function discover(source: string) {
  const tree = parser.parse(source)!;
  return discoverRegions(latexAdapter, tree, source, 'latex');
}

function proseText(source: string, region: { parts: readonly { startByte: number; endByte: number }[] }): string {
  return region.parts.map((part) => sliceSpanText(source, part as never)).join('\n');
}

describe('discoverLatexProse', () => {
  it('discovers a single ordinary paragraph spanning several lines', () => {
    const source = 'This is a paragraph\nof ordinary prose\nspanning three lines.\n';
    const regions = discover(source);
    const prose = regions.filter((r) => r.kind === 'prose');
    expect(prose).toHaveLength(1);
    expect(prose[0]!.parts).toHaveLength(3);
    expect(proseText(source, prose[0]!)).toBe(
      'This is a paragraph\nof ordinary prose\nspanning three lines.',
    );
  });

  it('splits two paragraphs at a blank line', () => {
    const source = 'First paragraph.\n\nSecond paragraph.\n';
    const prose = discover(source).filter((r) => r.kind === 'prose');
    expect(prose).toHaveLength(2);
  });

  it('splits a paragraph at a whole-line % comment, which becomes its own lineComment region', () => {
    const source = 'Before the comment.\n% a standalone comment\nAfter the comment.\n';
    const regions = discover(source);
    const prose = regions.filter((r) => r.kind === 'prose');
    const comments = regions.filter((r) => r.kind === 'lineComment');
    expect(prose).toHaveLength(2);
    expect(comments).toHaveLength(1);
    expect(sliceSpanText(source, comments[0]!.span)).toBe('% a standalone comment');
  });

  it('does not overlap a trailing % comment: the prose part ends before it, the comment stays its own region', () => {
    const source = 'text before % a trailing note\nmore text after\n';
    const regions = discover(source);
    const prose = regions.filter((r) => r.kind === 'prose');
    const comments = regions.filter((r) => r.kind === 'lineComment');
    expect(prose).toHaveLength(1);
    expect(comments).toHaveLength(1);
    // Neither region's span may overlap the other's.
    const proseFirstPart = prose[0]!.parts[0]!;
    expect(proseFirstPart.endByte).toBeLessThanOrEqual(comments[0]!.span.startByte);
    // Includes the trailing space right up to the comment's own start
    // column — the same "no trimming at a line's own boundary" behavior
    // Markdown's discoverProse already has for an ordinary line's end
    // column; only word-segmentation at reflow time normalizes it away.
    expect(sliceSpanText(source, proseFirstPart)).toBe('text before ');
  });

  it.each([
    ['verbatim', 'verbatim'],
    ['comment', 'comment'],
    ['lstlisting', 'lstlisting'],
    ['tikzpicture', 'tikzpicture'],
    ['tabular', 'tabular'],
    ['alltt', 'alltt'],
  ])('masks the entire %s environment, discovering zero prose regions inside it', (envName) => {
    const source = `\\begin{${envName}}\nThis text should never be reflowed.\n\\end{${envName}}\n`;
    const prose = discover(source).filter((r) => r.kind === 'prose');
    expect(prose).toHaveLength(0);
  });

  it('masks a math environment (align)', () => {
    const source = '\\begin{align}\nx &= y + z \\\\\n\\end{align}\n';
    const prose = discover(source).filter((r) => r.kind === 'prose');
    expect(prose).toHaveLength(0);
  });

  it('masks an array environment (classifies as math_environment, not generic)', () => {
    const source = '\\begin{array}{cc}\na & b \\\\\n\\end{array}\n';
    const prose = discover(source).filter((r) => r.kind === 'prose');
    expect(prose).toHaveLength(0);
  });

  it('masks \\[ ... \\] displayed math', () => {
    const source = 'Text before.\n\\[\nx = y + z\n\\]\nText after.\n';
    const regions = discover(source).filter((r) => r.kind === 'prose');
    expect(regions).toHaveLength(2);
    expect(proseText(source, regions[0]!)).toBe('Text before.');
    expect(proseText(source, regions[1]!)).toBe('Text after.');
  });

  it('does NOT mask abstract — the prose inside reflows normally', () => {
    const source = '\\begin{abstract}\nThis is the abstract text that should wrap normally.\n\\end{abstract}\n';
    const prose = discover(source).filter((r) => r.kind === 'prose');
    expect(prose).toHaveLength(1);
    expect(proseText(source, prose[0]!)).toBe(
      'This is the abstract text that should wrap normally.',
    );
  });

  it('does NOT mask itemize — \\item content is prose-eligible', () => {
    const source = '\\begin{itemize}\n\\item First item text.\n\\item Second item text.\n\\end{itemize}\n';
    const prose = discover(source).filter((r) => r.kind === 'prose');
    expect(prose).toHaveLength(2);
    expect(proseText(source, prose[0]!)).toBe('First item text.');
    expect(proseText(source, prose[1]!)).toBe('Second item text.');
  });

  it('starts an \\item region after its optional [label]', () => {
    const source = '\\begin{itemize}\n\\item[custom] Labeled item text.\n\\end{itemize}\n';
    const prose = discover(source).filter((r) => r.kind === 'prose');
    expect(prose).toHaveLength(1);
    expect(proseText(source, prose[0]!)).toBe('Labeled item text.');
  });

  describe('indentColumn is the marker column, not the content column, for an \\item region', () => {
    it('coincides with the content-start column for an ordinary paragraph (no change)', () => {
      const source = '  This paragraph is indented two spaces.\n';
      const [region] = discover(source).filter((r) => r.kind === 'prose');
      expect(region!.indentColumn).toBe(2);
      expect(region!.parts[0]!.startColumn).toBe(2);
    });

    it('is the \\item marker\'s own column, shorter than the item\'s real content-start column', () => {
      const source = '\\begin{itemize}\n  \\item \\label{item:foo} Item text.\n\\end{itemize}\n';
      const [region] = discover(source).filter((r) => r.kind === 'prose');
      // "  \item \label{item:foo} " is 25 columns wide — the region's own
      // content (region.parts[0].startColumn) starts there, but
      // indentColumn must stay at 2 (the marker's own column) for
      // wrapLatexProse's firstLineReserve derivation to produce correctly
      // wide continuation lines instead of needlessly narrow ones — see
      // ./wrap-prose.ts's own doc comment on firstLineReserve.
      expect(region!.indentColumn).toBe(2);
      expect(region!.parts[0]!.startColumn).toBe(25);
    });

    it('is the marker column for an unlabeled item too, still shorter than the content column', () => {
      const source = '\\begin{itemize}\n  \\item Item text here.\n\\end{itemize}\n';
      const [region] = discover(source).filter((r) => r.kind === 'prose');
      // "  \item " is 8 columns wide.
      expect(region!.indentColumn).toBe(2);
      expect(region!.parts[0]!.startColumn).toBe(8);
    });
  });

  it('excludes a \\label{...} chained right after \\item from the item\'s own prose text', () => {
    const source = '\\begin{itemize}\n\\item \\label{item:foo} Item text.\n\\end{itemize}\n';
    const prose = discover(source).filter((r) => r.kind === 'prose');
    expect(prose).toHaveLength(1);
    expect(proseText(source, prose[0]!)).toBe('Item text.');
  });

  it('excludes a \\label{...} chained after \\item\'s own [bracket label] too', () => {
    const source = '\\begin{itemize}\n\\item[custom] \\label{item:foo} Item text.\n\\end{itemize}\n';
    const prose = discover(source).filter((r) => r.kind === 'prose');
    expect(prose).toHaveLength(1);
    expect(proseText(source, prose[0]!)).toBe('Item text.');
  });

  it('excludes a plain \\command{arg} structural line from prose', () => {
    const source = '\\maketitle\nOrdinary paragraph text here.\n';
    const prose = discover(source).filter((r) => r.kind === 'prose');
    expect(prose).toHaveLength(1);
    expect(proseText(source, prose[0]!)).toBe('Ordinary paragraph text here.');
  });

  it('excludes a \\section{Title} header line from prose, but not its body', () => {
    const source = '\\section{Introduction}\nThe body paragraph follows the header.\n';
    const prose = discover(source).filter((r) => r.kind === 'prose');
    expect(prose).toHaveLength(1);
    expect(proseText(source, prose[0]!)).toBe('The body paragraph follows the header.');
  });

  it('excludes a \\section header line even with nested braces in the title (tree fallback)', () => {
    const source = '\\section{Title with \\emph{nested} braces}\nBody text follows.\n';
    const prose = discover(source).filter((r) => r.kind === 'prose');
    expect(prose).toHaveLength(1);
    expect(proseText(source, prose[0]!)).toBe('Body text follows.');
  });

  it('excludes a \\newtheorem declaration line (multiple argument groups)', () => {
    const source = '\\newtheorem{thm}[counter]{Theorem}\nOrdinary prose paragraph.\n';
    const prose = discover(source).filter((r) => r.kind === 'prose');
    expect(prose).toHaveLength(1);
    expect(proseText(source, prose[0]!)).toBe('Ordinary prose paragraph.');
  });

  it('discovers zero prose regions for a file with only structural lines and no prose', () => {
    const source = '\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\n\\maketitle\n\\end{document}\n';
    const prose = discover(source).filter((r) => r.kind === 'prose');
    expect(prose).toHaveLength(0);
  });

  describe('chained structural commands on one line (found by review after this file first shipped)', () => {
    it('excludes \\section{Title}\\label{sec:foo} chained with no space between them', () => {
      const source = '\\section{Introduction}\\label{sec:intro}\nBody paragraph follows.\n';
      const prose = discover(source).filter((r) => r.kind === 'prose');
      expect(prose).toHaveLength(1);
      expect(proseText(source, prose[0]!)).toBe('Body paragraph follows.');
    });

    it('excludes \\section{Title} \\label{sec:foo} chained with a space between them', () => {
      const source = '\\section{Introduction} \\label{sec:intro}\nBody paragraph follows.\n';
      const prose = discover(source).filter((r) => r.kind === 'prose');
      expect(prose).toHaveLength(1);
      expect(proseText(source, prose[0]!)).toBe('Body paragraph follows.');
    });

    it('excludes a chained header even when there is no following body at all (whole file is structural)', () => {
      const source = '\\section{Introduction}\\label{sec:intro}\n';
      const prose = discover(source).filter((r) => r.kind === 'prose');
      expect(prose).toHaveLength(0);
    });

    it('excludes a nested-brace title chained with a second command (tree fallback mid-chain)', () => {
      const source =
        '\\section{Title with \\emph{nested} braces}\\label{sec:foo}\nBody text follows.\n';
      const prose = discover(source).filter((r) => r.kind === 'prose');
      expect(prose).toHaveLength(1);
      expect(proseText(source, prose[0]!)).toBe('Body text follows.');
    });

    it('excludes three or more chained commands on one line', () => {
      const source = '\\subsection{Details}\\label{sec:details}\\index{details}\nBody text.\n';
      const prose = discover(source).filter((r) => r.kind === 'prose');
      expect(prose).toHaveLength(1);
      expect(proseText(source, prose[0]!)).toBe('Body text.');
    });

    it('still does NOT exclude real prose text following a structural command on the same line (documented remaining gap)', () => {
      // \section{Title} is itself excludable, but "extra text" after it is
      // real content the command/tree scanner can't consume — the whole
      // line still isn't recognized as structural, and (unlike the
      // pure-chain case above) there's no fix for this one yet: splitting
      // one physical line into an excluded header prefix plus a *new*
      // prose region for the remainder is a real, separate piece of work,
      // not covered by this chain fix.
      const source = '\\section{Title} extra text follows here.\nMore body text.\n';
      const prose = discover(source).filter((r) => r.kind === 'prose');
      expect(prose).toHaveLength(1);
      expect(proseText(source, prose[0]!)).toBe(
        '\\section{Title} extra text follows here.\nMore body text.',
      );
    });
  });
});
