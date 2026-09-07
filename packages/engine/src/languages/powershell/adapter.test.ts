import { Parser, Language } from 'web-tree-sitter';
import { beforeAll, describe, expect, it } from 'vitest';
import { discoverRegions } from '../../discovery/discover-regions.js';
import { powershellAdapter } from './adapter.js';

let parser: Parser;

beforeAll(async () => {
  await Parser.init();
  parser = new Parser();
  parser.setLanguage(await Language.load('grammars/tree-sitter-powershell.wasm'));
});

describe('powershellAdapter', () => {
  it('classifies a # comment as lineComment', () => {
    const source = '# a comment\nWrite-Host "hi"\n';
    const tree = parser.parse(source)!;
    const [region] = discoverRegions(powershellAdapter, tree, source, 'powershell');
    expect(region!.kind).toBe('lineComment');
  });

  it('classifies a plain <# #> block with no recognized tag as blockComment', () => {
    const source = '<# just a plain block comment, no tags at all #>\nWrite-Host "hi"\n';
    const tree = parser.parse(source)!;
    const [region] = discoverRegions(powershellAdapter, tree, source, 'powershell');
    expect(region!.kind).toBe('blockComment');
  });

  it('classifies a <# #> block containing a recognized .SYNOPSIS tag as docComment', () => {
    const source = '<#\n.SYNOPSIS\nDoes a thing.\n#>\nfunction Foo {}\n';
    const tree = parser.parse(source)!;
    const [region] = discoverRegions(powershellAdapter, tree, source, 'powershell');
    expect(region!.kind).toBe('docComment');
  });

  it('classifies a <# #> block containing .PARAMETER as docComment too', () => {
    const source = '<#\n.PARAMETER Name\nThe name.\n#>\nfunction Foo {}\n';
    const tree = parser.parse(source)!;
    const [region] = discoverRegions(powershellAdapter, tree, source, 'powershell');
    expect(region!.kind).toBe('docComment');
  });

  it('does not misread an ordinary sentence starting with a period as comment-based help', () => {
    // ".NET" and similar are real prose this project doesn't want to
    // misclassify -- `commentBasedHelpDialect`'s own `KNOWN_TAGS` fixed
    // vocabulary is what keeps a bare `.word` from scoring at all.
    const source = '<# This project targets .NET and nothing else. #>\nWrite-Host "hi"\n';
    const tree = parser.parse(source)!;
    const [region] = discoverRegions(powershellAdapter, tree, source, 'powershell');
    expect(region!.kind).toBe('blockComment');
  });

  it('discovers a mix of all three comment forms, each with its own kind', () => {
    const source = '<#\n.SYNOPSIS\nx\n#>\nfunction Foo {\n  # line\n  <# plain #>\n}\n';
    const tree = parser.parse(source)!;
    const regions = discoverRegions(powershellAdapter, tree, source, 'powershell');
    expect(regions.map((r) => r.kind)).toEqual(['docComment', 'lineComment', 'blockComment']);
  });

  it('discovers nothing else besides comments', () => {
    const source = 'Write-Host "a plain PowerShell string value, never a wrappable region"\n';
    const tree = parser.parse(source)!;
    const regions = discoverRegions(powershellAdapter, tree, source, 'powershell');
    expect(regions).toEqual([]);
  });
});
