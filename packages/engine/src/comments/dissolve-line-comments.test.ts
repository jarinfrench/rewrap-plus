import { Parser, Language } from 'web-tree-sitter';
import { beforeAll, describe, expect, it } from 'vitest';
import { discoverRegions } from '../discovery/discover-regions.js';
import type { Block } from '../types/document.js';
import { pythonAdapter } from '../languages/python/adapter.js';
import { pythonDescriptor } from '../languages/python/descriptor.js';
import { dissolveLineComments } from './dissolve-line-comments.js';

const grammarPath = 'grammars/tree-sitter-python.wasm';

let parser: Parser;

beforeAll(async () => {
  await Parser.init();
  const language = await Language.load(grammarPath);
  parser = new Parser();
  parser.setLanguage(language);
});

function discoverLineComment(source: string) {
  const tree = parser.parse(source)!;
  const [region] = discoverRegions(pythonAdapter, tree, source, 'python');
  if (!region) {
    throw new Error(`test setup: no region discovered in '${source}'`);
  }
  return { region, source };
}

function words(block: Block): string[] {
  if (block.type !== 'paragraph' && block.type !== 'listItem') {
    throw new Error(`expected an atom-bearing block, got '${block.type}'`);
  }
  return block.atoms.map((a) => a.text);
}

describe('dissolveLineComments -- reflowable content', () => {
  it('strips the marker and a single following space', () => {
    const { region, source } = discoverLineComment('# hello world\n');
    const dissolved = dissolveLineComments(region, source, pythonDescriptor);

    expect(dissolved.document.blocks).toHaveLength(1);
    expect(words(dissolved.document.blocks[0]!)).toEqual(['hello', 'world']);
  });

  it('observes a spaceless marker convention and reports it', () => {
    const { region, source } = discoverLineComment('#hello world\n');
    const dissolved = dissolveLineComments(region, source, pythonDescriptor);

    expect(dissolved.spaceAfterMarker).toBe(false);
    expect(words(dissolved.document.blocks[0]!)).toEqual(['hello', 'world']);
  });

  it('observes a spaced marker convention and reports it', () => {
    const { region, source } = discoverLineComment('# hello world\n');
    const dissolved = dissolveLineComments(region, source, pythonDescriptor);

    expect(dissolved.spaceAfterMarker).toBe(true);
  });

  it('merges consecutive comment lines into one reflowable paragraph', () => {
    const { region, source } = discoverLineComment('# first line of the\n# same paragraph\n');
    const dissolved = dissolveLineComments(region, source, pythonDescriptor);

    expect(dissolved.document.blocks).toHaveLength(1);
    expect(dissolved.document.blocks[0]!.type).toBe('paragraph');
    expect(words(dissolved.document.blocks[0]!)).toEqual([
      'first',
      'line',
      'of',
      'the',
      'same',
      'paragraph',
    ]);
  });

  it('turns a bare "#" separator line into a blank block, splitting the paragraph', () => {
    const { region, source } = discoverLineComment('# first para\n#\n# second para\n');
    const dissolved = dissolveLineComments(region, source, pythonDescriptor);

    expect(dissolved.document.blocks.map((b) => b.type)).toEqual([
      'paragraph',
      'blank',
      'paragraph',
    ]);
  });

  it('carries the region indentColumn into DocMeta', () => {
    const { region, source } = discoverLineComment('if True:\n    # indented\n    pass\n');
    const dissolved = dissolveLineComments(region, source, pythonDescriptor);

    expect(dissolved.document.meta.indentColumn).toBe(region.indentColumn);
    expect(region.indentColumn).toBe(4);
  });
});

describe('dissolveLineComments -- directive lines', () => {
  it('keeps a shebang line verbatim, unstripped', () => {
    const { region, source } = discoverLineComment('#!/usr/bin/env python\n');
    const dissolved = dissolveLineComments(region, source, pythonDescriptor);

    expect(dissolved.document.blocks).toEqual([
      { type: 'verbatim', lines: ['#!/usr/bin/env python'] },
    ]);
  });

  it('keeps a noqa directive verbatim inside an otherwise-reflowable block', () => {
    const { region, source } = discoverLineComment(
      '# a normal comment line\n# noqa: E501\n# another normal line\n',
    );
    const dissolved = dissolveLineComments(region, source, pythonDescriptor);

    expect(dissolved.document.blocks.map((b) => b.type)).toEqual([
      'paragraph',
      'verbatim',
      'paragraph',
    ]);
    const verbatim = dissolved.document.blocks[1];
    expect(verbatim).toEqual({ type: 'verbatim', lines: ['# noqa: E501'] });
  });

  it('batches consecutive directive lines into one verbatim block', () => {
    const { region, source } = discoverLineComment(
      '# type: ignore\n# pylint: disable=broad-except\n',
    );
    const dissolved = dissolveLineComments(region, source, pythonDescriptor);

    expect(dissolved.document.blocks).toEqual([
      { type: 'verbatim', lines: ['# type: ignore', '# pylint: disable=broad-except'] },
    ]);
  });
});

describe('dissolveLineComments -- commented-out code', () => {
  it('routes a run that reads as code to one verbatim block, unstripped', () => {
    const { region, source } = discoverLineComment(
      '# def old_function(argument_one, argument_two):\n' +
        '#     return argument_one + argument_two\n',
    );
    const dissolved = dissolveLineComments(region, source, pythonDescriptor);

    expect(dissolved.document.blocks).toEqual([
      {
        type: 'verbatim',
        lines: [
          '# def old_function(argument_one, argument_two):',
          '#     return argument_one + argument_two',
        ],
      },
    ]);
  });

  it('still reflows an ordinary prose comment block', () => {
    const { region, source } = discoverLineComment(
      '# This explains what the function below does in plain English.\n',
    );
    const dissolved = dissolveLineComments(region, source, pythonDescriptor);

    expect(dissolved.document.blocks[0]!.type).toBe('paragraph');
  });
});
