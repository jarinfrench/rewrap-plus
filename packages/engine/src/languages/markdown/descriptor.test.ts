import { Parser, Language, Query } from 'web-tree-sitter';
import { beforeAll, describe, expect, it } from 'vitest';
import { validateDescriptor } from '../../adapter-registry.js';
import type { SyntaxNode } from '../../types/tree-sitter-types.js';
import { markdownDescriptor } from './descriptor.js';

/**
 * Real node-name/geometry assertions against the vendored
 * `tree-sitter-markdown` grammar — not a placeholder suite. Every
 * assertion here traces back to a finding `docs/spikes/tree-sitter-markdown-probe.mjs`
 * made directly against the grammar and `docs/parsing.md` Finding 7
 * recorded, per this project's "probe before coding, always" rule: this
 * file is what makes those findings a durable regression guard rather
 * than a one-off spike result, so a future grammar bump that renames or
 * reshapes any of this fails loudly here instead of silently corrupting
 * discovery downstream.
 */
const grammarPath = 'grammars/tree-sitter-markdown.wasm';

let parser: Parser;

beforeAll(async () => {
  await Parser.init();
  const language = await Language.load(grammarPath);
  parser = new Parser();
  parser.setLanguage(language);
});

function findAll(node: SyntaxNode, type: string, out: SyntaxNode[] = []): SyntaxNode[] {
  if (node.type === type) out.push(node);
  for (const child of node.children) {
    if (child) findAll(child, type, out);
  }
  return out;
}

describe('markdownDescriptor', () => {
  it('passes structural validation', () => {
    expect(() => validateDescriptor(markdownDescriptor)).not.toThrow();
  });

  it('declares no comment/string queries or strings block at all', () => {
    expect(markdownDescriptor.queries.comments).toBeUndefined();
    expect(markdownDescriptor.queries.strings).toBeUndefined();
    expect(markdownDescriptor.strings).toBeUndefined();
  });

  it('declares <!-- as its directive marker, not a line-comment marker (it has none)', () => {
    expect(markdownDescriptor.directives?.marker).toBe('<!--');
    expect(markdownDescriptor.comments.line).toBeUndefined();
  });

  it('declares a queries.prose that compiles against its own vendored grammar', async () => {
    const language = await Language.load(grammarPath);
    expect(() => new Query(language, markdownDescriptor.queries.prose!).delete()).not.toThrow();
  });

  it('grammar loads and reports an ABI compatible with the pinned web-tree-sitter version', async () => {
    const language = await Language.load(grammarPath);
    expect(language.abiVersion).toBeGreaterThanOrEqual(13);
    expect(language.abiVersion).toBeLessThanOrEqual(15);
  });
});

describe('paragraph geometry — confirmed against the real grammar', () => {
  it('starts a plain paragraph at column 0, no container marker', () => {
    const tree = parser.parse('hello world\n')!;
    const [paragraph] = findAll(tree.rootNode, 'paragraph');
    expect(paragraph!.startPosition).toEqual({ row: 0, column: 0 });
  });

  it('starts a block-quoted paragraph right after the "> " marker', () => {
    const tree = parser.parse('> hello world\n')!;
    const [paragraph] = findAll(tree.rootNode, 'paragraph');
    expect(paragraph!.startPosition).toEqual({ row: 0, column: 2 });
  });

  it('starts a nested block-quoted paragraph right after the ">> " marker', () => {
    const tree = parser.parse('>> hello world\n')!;
    const [paragraph] = findAll(tree.rootNode, 'paragraph');
    expect(paragraph!.startPosition).toEqual({ row: 0, column: 3 });
  });

  it('starts a list-item paragraph right after the marker and its hanging space', () => {
    const tree = parser.parse('- hello world\n')!;
    const [paragraph] = findAll(tree.rootNode, 'paragraph');
    expect(paragraph!.startPosition).toEqual({ row: 0, column: 2 });
  });

  it('starts an ordered-list-item paragraph right after the marker', () => {
    const tree = parser.parse('1. hello world\n')!;
    const [paragraph] = findAll(tree.rootNode, 'paragraph');
    expect(paragraph!.startPosition).toEqual({ row: 0, column: 3 });
  });

  it('starts a task-list-item paragraph right after the checkbox', () => {
    const tree = parser.parse('- [ ] hello world\n')!;
    const [paragraph] = findAll(tree.rootNode, 'paragraph');
    expect(paragraph!.startPosition).toEqual({ row: 0, column: 6 });
  });

  it('places block_continuation as a child of inline, not a direct child of paragraph', () => {
    // The one real discrepancy from a naive node-types.json reading,
    // confirmed by the Phase A probe (docs/parsing.md Finding 7) — parts
    // geometry must be built from source lines/row range, never from
    // walking this structure, precisely because of this.
    const tree = parser.parse('> line one\n> line two\n')!;
    const [paragraph] = findAll(tree.rootNode, 'paragraph');
    expect(paragraph!.children.map((c) => c?.type)).toEqual(['inline']);
    const [inline] = findAll(paragraph!, 'inline');
    expect(inline!.children.some((c) => c?.type === 'block_continuation')).toBe(true);
  });

  it('produces no block_continuation node for a lazy continuation line', () => {
    const tree = parser.parse('> hello world\nsecond line lazily continues\n')!;
    const [paragraph] = findAll(tree.rootNode, 'paragraph');
    expect(findAll(paragraph!, 'block_continuation')).toHaveLength(0);
  });

  it('reproduces every interior \\r\\n pair verbatim across a multi-line CRLF paragraph', () => {
    const tree = parser.parse('line one\r\nline two\r\nline three\r\n')!;
    const [paragraph] = findAll(tree.rootNode, 'paragraph');
    const text = 'line one\r\nline two\r\nline three\r\n'.slice(
      paragraph!.startIndex,
      paragraph!.endIndex,
    );
    expect(text).toContain('\r\n');
    expect((text.match(/\r\n/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('ends a setext heading\'s children as exactly [paragraph, underline]', () => {
    const tree = parser.parse('Heading Text\n============\n')!;
    const [setext] = findAll(tree.rootNode, 'setext_heading');
    expect(setext!.children.map((c) => c?.type)).toEqual(['paragraph', 'setext_h1_underline']);
  });

  it('ends an in-progress paragraph before a pipe table with no blank line between them', () => {
    const tree = parser.parse('some text\n| a | b |\n|---|---|\n')!;
    const [paragraph] = findAll(tree.rootNode, 'paragraph');
    const [table] = findAll(tree.rootNode, 'pipe_table');
    expect(paragraph!.endPosition.row).toBeLessThanOrEqual(table!.startPosition.row);
  });
});

describe('compile-time extensions confirmed active in the vendored release asset', () => {
  it('parses a pipe table as a pipe_table node (EXTENSION_GFM)', () => {
    const tree = parser.parse('| a | b |\n|---|---|\n| 1 | 2 |\n')!;
    expect(findAll(tree.rootNode, 'pipe_table')).toHaveLength(1);
  });

  it('parses YAML front matter as a minus_metadata node', () => {
    const tree = parser.parse('---\ntitle: Test\n---\n\nBody.\n')!;
    expect(findAll(tree.rootNode, 'minus_metadata')).toHaveLength(1);
  });

  it('parses TOML front matter as a plus_metadata node', () => {
    const tree = parser.parse('+++\ntitle = "Test"\n+++\n\nBody.\n')!;
    expect(findAll(tree.rootNode, 'plus_metadata')).toHaveLength(1);
  });
});
